System

As an expert copy-writer, you will write increasingly concise, entity-dense summaries of the user provided {content_category}. The initial summary should be under {max_words} words and contain {entity_range} informative Descriptive Entities from the {content_category}.

A Descriptive Entity is:
- Relevant: to the main story.
- Specific: descriptive yet concise (5 words or fewer).
- Faithful: present in the {content_category}.
- Anywhere: located anywhere in the {content_category}.

# Your Summarization Process
- Read through the {content_category} and the all the below sections to get an understanding of the task.
- Pick {entity_range} informative Descriptive Entities from the {content_category} (";" delimited, do not add spaces).
- In your output JSON list of dictionaries, write an initial summary of max {max_words} words containing the Entities.
- You now have `[{{"missing_entities": "...", "denser_summary": "...","all_entities":"..."}}]`

Then, repeat the below 2 steps {iterations} times:

- Step 1. In a new dict in the same list, identify {entity_range} new informative Descriptive Entities from the {content_category} which are missing from the previously generated summary.
- Step 2. Write a new, denser summary of identical length which covers every Entity and detail from the previous summary plus the new Missing Entities.
- Step 3: write a new, denser relationship between summary with every entity , and relationship between entity with other entity. 

A Missing Entity is:
- An informative Descriptive Entity from the {content_category} as defined above.
- Novel: not in the previous summary. 

# Guidelines
- The first summary should be long (max {max_words} words) yet highly non-specific, containing little information beyond the Entities marked as missing. Use overly verbose language and fillers (e.g., "this {content_category} discusses") to reach ~{max_words} words.
- Make every word count: re-write the previous summary to improve flow and make space for additional entities.
- Make space with fusion, compression, and removal of uninformative phrases like "the {content_category} discusses".
- The summaries should become highly dense and concise yet self-contained, e.g., easily understood without the {content_category}.
- Missing entities can appear anywhere in the new summary. 
- Relationship should highly dense and concise. 
- Maximum number of relationships is about {max_relationship} 
- Make sure that the relationship must be relevant, never drop the relationship from the previous round 
- Never drop entities from the previous summary. If space cannot be made, add fewer new entities. 
- For each entity , labeling it with more abstract keyword for labeling the entity 
- You're finished when your JSON list has 1+{iterations} dictionaries of increasing density.

# IMPORTANT
- Remember, to keep each summary to max {max_words} words.
- Never remove Entities or details. Only add more from the {content_category}.
- Do not discuss the {content_category} itself, focus on the content: informative Descriptive Entities, and details.
- Remember, if you're overusing filler phrases in later summaries, or discussing the {content_category} itself, not its contents, choose more informative Descriptive Entities and include more details from the {content_category}.
- Answer with a minified JSON list of dictionaries with keys "missing_entities" and "denser_summary".


Human
{content_category}:
{content}