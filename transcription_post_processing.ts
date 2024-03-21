// using langchain this class will
// split the initial transcript into chunks of up to 2000 tokens
// generate insights from each chunk
// concatenate the insights into a single string
// return the concatenated string

import { ChatOpenAI } from "@langchain/openai";
import { BaseCallbackHandler, CallbackManager } from "langchain/callbacks";
import { LLMResult } from 'langchain/dist/schema';
import { HumanMessage,SystemMessage,AIMessage } from '@langchain/core/messages';
import { Document } from "langchain/document";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MapReduceDocumentsChain, StuffDocumentsChain, LLMChain, RefineDocumentsChain } from "langchain/chains";
import { PromptTemplate } from "langchain/prompts";
import MyPlugin, { timestampToMs } from "main";
import llamaTokenizer from "llama-tokenizer-js";
import * as fs from 'fs';
import * as path from 'path';



export class InsightsCallbackHandler extends BaseCallbackHandler {
    name: string;
    constructor() {
		super();
        this.name = "insights";
	}
    async handleLLMNewToken(token: string) {
        //console.log("token:", token)
    }
    async handleLLMError(error: Error) {
        console.error("error:", error)
    }
    async handleLLMEnd(output: LLMResult) {
        console.log("output:", output)
    }

}

export class TranscriptChunk {
    text : string;
    startTimeMs : number;
    endTimeMs : number;
    toKeep : boolean | undefined;
    index : number;
    sortIndex : number;

    constructor(text : string, startTimeMs : number, endTimeMs : number, index : number) {
        this.text = text;
        this.startTimeMs = startTimeMs;
        this.endTimeMs = endTimeMs;
        this.toKeep = undefined;
        this.index = index;
        this.sortIndex = index;
    }

    
    includes(otherChunk : TranscriptChunk, toleranceMs : number) {
        // returns true if the otherChunk time frame is with the current chunk time frame within the given tolerence
        // and the current chunk text is longer than the other chunk text
        // and the current chunk is not the same as the other chunk
        return ((this.startTimeMs - toleranceMs <= otherChunk.startTimeMs) && (this.endTimeMs + toleranceMs >= otherChunk.endTimeMs)) 
        && this.text.length >= otherChunk.text.length 
        && this.index != otherChunk.index
        ;        
    }


    sameTextIgnoringPunction(otherChunk : TranscriptChunk) {
        // returns true if the current chunk text is the same as the other chunk text, ignoring punctuation
        // and case
        return this.text.replace(/[^\w\s]/gi, '').toLowerCase() === otherChunk.text.replace(/[^\w\s]/gi, '').toLowerCase();
    }

    // string representation
    toString() {
        return `[${this.startTimeMs} --> ${this.endTimeMs}] ${this.text}`;
    }

    // equality
    equals(otherChunk : TranscriptChunk) {
        return this.index === otherChunk.index;
    }



}



function optimalStringAlignmentDistance(s : string, t : string) {
    // Determine the "optimal" string-alignment distance between s and t
    if (!s || !t) {
      return 99;
    }
    var m = s.length;
    var n = t.length;
    
    /* For all i and j, d[i][j] holds the string-alignment distance
     * between the first i characters of s and the first j characters of t.
     * Note that the array has (m+1)x(n+1) values.
     */
    var d = new Array();
    for (var i = 0; i <= m; i++) {
      d[i] = new Array();
      d[i][0] = i;
    }
    for (var j = 0; j <= n; j++) {
      d[0][j] = j;
    }
          
    // Determine substring distances
    var cost = 0;
    for (var j = 1; j <= n; j++) {
      for (var i = 1; i <= m; i++) {
        cost = (s.charAt(i-1) == t.charAt(j-1)) ? 0 : 1;   // Subtract one to start at strings' index zero instead of index one
        d[i][j] = Math.min(d[i][j-1] + 1,                  // insertion
                           Math.min(d[i-1][j] + 1,         // deletion
                                    d[i-1][j-1] + cost));  // substitution
                          
        if(i > 1 && j > 1 && s.charAt(i-1) == t.charAt(j-2) && s.charAt(i-2) == t.charAt(j-1)) {
          d[i][j] = Math.min(d[i][j], d[i-2][j-2] + cost); // transposition
        }
      }
    }
    
    // Return the strings' distance
    return d[m][n];
  }
  



export class TranscriptionPostProcessor {

    plugin : MyPlugin
    streaming_chat: ChatOpenAI;
    chat : ChatOpenAI;

    //constructor
    constructor(plugin : MyPlugin) {
        this.plugin = plugin;
        // set env variable OPENAI_API_KEY with random value
        process.env.OPENAI_API_KEY = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); 
        console.log("TranscriptionPostProcessor constructor")       
        console.log(optimalStringAlignmentDistance("Abxy", "bAxy"))
        console.log(optimalStringAlignmentDistance("Abxy", "aBxy"))

        this.chat = new ChatOpenAI({ 
            temperature : 0.01,
            modelName : this.plugin.settings.llamaLLM,
            maxConcurrency : 1
        },
        {
            baseURL : this.plugin.settings.llamaUrl,
        });

        this.streaming_chat = new ChatOpenAI({ 
            temperature : 0.01,
            modelName : this.plugin.settings.llamaLLM,
            streaming : true,
            maxConcurrency : 1,
            callbacks : [new InsightsCallbackHandler()]
        },
        {
           baseURL : this.plugin.settings.llamaUrl,
        });




    }

    // use llama-tokenizer-js for custom length function
    tokenizerLength(text : string){
        const encodedText = llamaTokenizer.encode(text);
        if (encodedText) {
            return encodedText.length;
        }
        return 0;
    }


    // function to clean up the transcript
    cleanUpTranscript(transcript : string) : string{  
        let transcriptChunks : TranscriptChunk[] = []; 
        // loop over transcript lines
        let chunkIdx = 0;
        for (const line of transcript.split('\n')) {
            // parse line into a TranscriptChunk using a regex
            const match = line.match(/\[(\d+:\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+)\]\s*(.*)/);
            if (match) {
                const startTime = match[1];
                const endTime = match[2];
                const text = match[3];
                const startTimeMs = timestampToMs(startTime);
                const endTimeMs = timestampToMs(endTime);
                const chunk = new TranscriptChunk(text, startTimeMs, endTimeMs,chunkIdx);
                //console.log("chunk", chunk)
                transcriptChunks.push(chunk);
                chunkIdx++;
            }            
        }
        console.log("before clean" , transcriptChunks)

        // reorder transcriptChunks by start time
        transcriptChunks.sort((a, b) => a.startTimeMs - b.startTimeMs);
        // update sort index
        for (let i = 0; i < transcriptChunks.length; i++) {
            transcriptChunks[i].sortIndex = i;
        }
        console.log("after sort", transcriptChunks)
        
        let previousChunk : TranscriptChunk = transcriptChunks[0] as TranscriptChunk;
        // loop over the transcriptChunks
        for (const chunk of transcriptChunks) {
            // if it is included in an other chunk reject it
            if (transcriptChunks.some(otherChunk => otherChunk.includes(chunk, 100) && (otherChunk.toKeep != false))) {
                console.log("reject chunk inluded", chunk)
                // log one othe chunk that include chunk
                const otherChunk = transcriptChunks.find(otherChunk => otherChunk.includes(chunk, 100) && (otherChunk.toKeep != false));
                console.log("other chunk", otherChunk)                
                chunk.toKeep = false;                
            }
            // if chunk text starts with previous chunk text discrad previous chunk
            else if (chunk.index > 0 && chunk.text.replace(/[^\w\s]/gi, '').toLowerCase().startsWith(previousChunk?.text.replace(/[^\w\s]/gi, '').toLowerCase()) && (previousChunk.toKeep != false)) {
                console.log("discard previous chunk", previousChunk)
                previousChunk.toKeep = false;
                //transcriptChunks.remove(previousChunk);
            }
            // if chunk is the end of the previous chunk discard current chunk
            else if (chunk.index > 0 && previousChunk?.text.replace(/[^\w\s]/gi, '').toLowerCase().endsWith(chunk.text.replace(/[^\w\s]/gi, '').toLowerCase()) && (previousChunk.toKeep != false)) {
                console.log("discard current chunk", chunk)
                chunk.toKeep = false;
            }
            // if chunk.text is the same ignoring punction as the previous chunk.text discard current chunk
            // if previous chunk is kept or undefined discard current chunk
            else if (chunk.index > 0 && previousChunk?.sameTextIgnoringPunction(chunk) && (previousChunk.toKeep != false)) {
                console.log("discard current chunk", chunk)
                chunk.toKeep = false;
            }
            if (chunk.toKeep !== false) {
                previousChunk = chunk;
            }

        }

        // remove all chunks where toKeep == false
        transcriptChunks = transcriptChunks.filter(chunk => chunk.toKeep !== false);

        console.log("after clean" , transcriptChunks)

        let fullText = ""
        // loop over the transcriptChunks
        for (const chunk of transcriptChunks) {
            console.log(chunk)
            fullText += chunk.text + "\n";
        }





        // remove [00:00:06.640 --> 00:00:10.660]  from the transcript with a regex
        const clean_transcript = fullText.replace(/\[.*\]\s/g, '');

        return clean_transcript;
    }


    async deduplicateWithGenAI(transcript : string): Promise<string> {
        // split the transcript with langchain recursive text splitter        
        const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 2000, chunkOverlap: 200, lengthFunction: this.tokenizerLength });
        const docs = await textSplitter.createDocuments([transcript]);

        console.log("number of chunks:", docs.length)


        const deduplicatedChunks = []
        // loop on chuncks
        for (const doc of docs){
            // run a ddeplucation prompt on each doc
            const deduplication_prompt = PromptTemplate.fromTemplate("Deduplicate the following text:\n {text}");
            const deduplication_chain = new LLMChain({ llm: this.chat, prompt: deduplication_prompt});
            const deduplicated_text = await deduplication_chain.call({ text: doc.pageContent });
            deduplicatedChunks.push(deduplicated_text.text)
            console.log("deduplicated text")
            console.log(doc.pageContent)
            console.log(deduplicated_text.text)            
        }

        const deduplicatedTranscript = deduplicatedChunks.join('\n\n');
        console.log("deduplicated transcript",deduplicatedTranscript)


        return deduplicatedTranscript;
    }


    async tldr(transcript : string) : Promise<string> {
        // split the transcript with langchain recursive text splitter        
        const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 3000, chunkOverlap: 200, lengthFunction: this.tokenizerLength });
        const docs = await textSplitter.createDocuments([transcript]);

        const tldr_prompt = PromptTemplate.fromTemplate("Please read the provided Original section to understand the context and content." +
        "Use this understanding to generate a summary of the Original section."+
        "Separate the transcript into chunks, and sequentially create a summary for each chunk."+
        "Focus on summarizing the Original section.\n"+
        "Summarized Sections:\n"+
        "1. For each chunk, provide a concise summary. Start each summary with \"Chunk (X of Y):\""+
        "where X is the current chunk number and Y is the total number of chunks.\n"+
        "\n\nOriginal Section:\n"+
        "{text}");


        const combine_prompt = PromptTemplate.fromTemplate("1. Read the Summarized Sections: Carefully review all the summarized sections you have generated."+
        "Ensure that you understand the main points, key details, and essential information from each section.\n"+
        "2. Identify Main Themes: Identify the main themes and topics that are prevalent throughout the summarized sections. These themes will form the backbone of your final summary.\n"+ 
        "3. Consolidate Information: Merge the information from the different summarized sections, focusing on the main themes you have identified. Avoid redundancy and ensure the consolidated information flows logically.\n"+
        "4. Preserve Essential Details: Preserve the essential details and nuances that are crucial for understanding the document. Consider the type of document and the level of detail required to capture its essence.\n"+
        "5. Draft the Final Summary: After considering all the above points, draft a final summary that represents the main ideas, themes, and essential details of the note. Start this section with \"Final Summary:\". :\n"+
        "\n\nSummarize sections\n{summaries}")
        // use a map reduce chain
        const map_reduce_chain = new MapReduceDocumentsChain({
            llmChain : new LLMChain({ llm: this.chat, prompt: tldr_prompt}),
            documentVariableName : "text",
            combineDocumentChain : new StuffDocumentsChain({ llmChain : new LLMChain({ llm: this.chat, prompt: combine_prompt}), documentVariableName : "summaries"}),
            maxTokens : 2000,
            maxIterations : 1,
        });
        const result = await map_reduce_chain.invoke({
            input_documents : docs,
        })

        console.log(result)
        const final_result = result.text.trim();
        console.log(final_result)
        return final_result;


    }


    async chain_of_density(transcript : string) : Promise<string> {
        // split the transcript with langchain recursive text splitter
        const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 2048, chunkOverlap: 200, lengthFunction: this.tokenizerLength });
        const docs = await textSplitter.createDocuments([transcript]);

        // load from prompts/chain_of_density.md
        // /Users/flolac/dev/obsidian/dev-plugin/.obsidian/plugins/obsidian-whisper/prompts/chain_of_density.md
        const density_prompt_text = fs.readFileSync(path.join(this.plugin.vaultPath, '.obsidian/plugins/obsidian-whisper/prompts/chain_of_density.md'), 'utf8');
        console.log(density_prompt_text)
        const density_prompt = new PromptTemplate({
            template: density_prompt_text,
            inputVariables: ['content'],
            partialVariables: {
                'content_category': "Audio Transcript",
                'entity_range': "1-3",
                'max_words': "80",
                'iterations': "2",
                'max_relationship' : "4",
            }
        });
        const formatted_prompt = await density_prompt.format({"content" : docs[0].pageContent});

        console.log(formatted_prompt)
        const combine_prompt = PromptTemplate.fromTemplate("Combine the following summaries:\n{summaries}")
        
        const density_chain = new LLMChain({ llm: this.chat, prompt: density_prompt})

        // loop over documents and run density prompt on each
        const density_results : string[] = []
        var grouped_result_index = 0;
        const grouped_results : string[][]= []; 
        let idx = 1;
        console.log("number of chunks:", docs.length);
        for (const doc of docs){
            console.log(`processing chunk ${idx}/${docs.length}`);
            idx++;
         
            const density_result = await density_chain.call({ content: doc.pageContent });
            console.log("density_result",density_result.text);

            // extract the last dense summary:
            // case 1: density_result.text is a json
            let dense_summary = ""
            if (density_result.text.startsWith("[")) {
                console.log("case 1: density_result.text is a json");
                const regex = /denser_summary":\s*"(.*)"/gmi
                const matches = density_result.text.matchAll(regex);

                if (matches) {
                    console.log("matches", matches);
                    const groupsArr = [...matches];
                    for (const groups of groupsArr) {
                        console.log(groups);
                        if (groups) {
                            dense_summary = groups[groups.length - 1];
                        }
    
                    }
                }      
            } 
            // case 2: density_result.text is a string
            // regex multi line ignoring case : Denser summary:.*\n*(.*)
            else {
                console.log("case 2: density_result.text is a string");
                const regex = /Denser summary:.*\n*(.*)/gmi;
                const matches = density_result.text.matchAll(regex);
             
                if (matches) {
                    console.log("matches", matches);
                    const groupsArr = [...matches];
                    for (const groups of groupsArr) {
                        console.log(groups);
                        if (groups) {
                            dense_summary = groups[groups.length - 1];
                        }
    
                    }

                }      
                // case 3 bullet points
                // regex bullet points ignoring case : summary.*:\s*(?<bullets>(-.*\s)*)*
                else {
                    console.log("case 3: density_result.text is a string with bullet points");
                    density_result.text = density_result.text.replace(/summary.*:\s*$/gmi, '').trim();
                    console.log("density_result.text", density_result.text);
                    const regex_bullets = /summary.*:\s*(?<bullets>(-.*\s)*)*$/gmi;
                    const match_bullets = density_result.text.matchAll(regex_bullets);                   
                    if (match_bullets) {
                        console.log("match_bullets", match_bullets);
                        const groupsArr = [...match_bullets];
                        for (const groups of groupsArr) {
                            console.log(groups);
                            if (groups) {
                                dense_summary = groups[groups.length - 1];
                            }
        
                        }
    
                    }
                }
    
            }
            console.log(dense_summary)
            density_results.push(dense_summary)
            if (grouped_result_index >= grouped_results.length-1) {
                grouped_results.push([])
            }
            grouped_results[grouped_result_index].push(dense_summary)
            // increment index if grouped_results[index] number of tokens is over 2000
            let grouped_token = 0;
            for (const result of grouped_results[grouped_result_index]) {
                grouped_token += this.tokenizerLength(result);
            }
            if (grouped_token > 1024) {
                grouped_result_index++;
            }
        }

        console.log("grouped_results",grouped_results);


        // reduce each grouped result
        const reduce_chain = new LLMChain({ llm: this.chat, prompt: combine_prompt});
        const reduce_results : string[] = []
        for (const grouped_result of grouped_results) {
            if (grouped_result.length>0){
                const reduce_result = await reduce_chain.invoke({ summaries: grouped_result.join('\n\n') });
                reduce_results.push(reduce_result.text)
            }
            
        }

        console.log("reduce_results", reduce_results)

        if (reduce_results.length == 1) {
            return reduce_results[0];
        }
        // reduce reduce_results
        const reduce_reduce_result = await reduce_chain.invoke({ summaries: reduce_results.join('\n\n') });
        const final_result = reduce_reduce_result.text.trim();
        console.log(final_result)
        return final_result;
            
        
    
    }


    //function to process the initial transcript
    async process(transcript: string) {


        //transcript = this.cleanUpTranscript(transcript)


        console.log(transcript)

        const deduplicatedTranscript = transcript; //await this.deduplicateWithGenAI(transcript)

        if (1>0) {
            const tldr = await this.chain_of_density(deduplicatedTranscript);
            return tldr;
        }


     
        const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 2000, chunkOverlap: 200, lengthFunction: this.tokenizerLength });


        // deduplicated docs
        const deduplicatedDocs = await textSplitter.createDocuments([deduplicatedTranscript]);

        console.log("number of deduplicated chunks:", deduplicatedDocs.length)

        const prompt_on_individual_chunk = PromptTemplate.fromTemplate("Identify the main topics the following part of an audio transcription:\n {transcription}");
        const chain = new LLMChain({ llm: this.chat, prompt: prompt_on_individual_chunk});

        const prompt_combine_chunks = PromptTemplate.fromTemplate("consolidate the topics avoiding duplication and regrouping topics where pertinent:\n {topics}");
        const chain_combine_chunks = new LLMChain({ llm: this.chat, prompt: prompt_combine_chunks });

        const reduce_chain = new StuffDocumentsChain({
            llmChain : chain_combine_chunks,
            documentVariableName : "topics",
        });
        
        const map_reduce_chain = new MapReduceDocumentsChain({
            llmChain : chain,
            documentVariableName : "transcription",
            combineDocumentChain : reduce_chain,
            maxTokens : 2000,
            maxIterations : 1,



        });


        if (deduplicatedDocs.length > 1) {

            const result_map_reduce = await map_reduce_chain.invoke({
                input_documents : deduplicatedDocs,
            })

            console.log(result_map_reduce)
            const final_result = result_map_reduce.text.trim();
            console.log(final_result)

            if (final_result.length > 0){
                return final_result;
            }
        } else {
            const result = await chain.invoke({ transcription: deduplicatedDocs[0].pageContent })
            const final_result = result.text.trim();
            console.log(final_result);
            return final_result;

        }
        return ""
               
    }
}