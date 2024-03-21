import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, SuggestModal } from 'obsidian';
import { TranscriptionPostProcessor } from 'transcription_post_processing';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	llamaUrl: string;
	llamaLLM: string;
	whisperPath: string;
	whipserModel: string;
	audioDeviceId : number;
	defaultLanguage : string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	whisperPath: "~/dev/whisper.cpp",
	whipserModel: "~/dev/whisper.cpp/models/ggml-large-v3.bin",
	audioDeviceId: 2,
	defaultLanguage: "en",
	llamaUrl: 'http://localhost:8000/v1',
	llamaLLM: 'capybarahermes-2.5-mistral-7b'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	isTranscribing : boolean = false;
	transcriptionPid : number = 0;
	vaultPath : string;
	transcriptionFile : TFile;
	currentLanguage : string = "en";
	languageBarItemEl: HTMLElement;

	// setter for currentLanguage
	setCurrentLanguage(language : string) {
		this.currentLanguage = language;
		// update the language in the status bar
		this.languageBarItemEl.setText('Transcribing langugage (' + this.currentLanguage + ')');
	}	
	async onload() {
		await this.loadSettings();

		this.vaultPath = (this.app.vault.adapter as any).basePath + "/";
		console.log(this.vaultPath);
		// this create an icon on the left ribbon to generate insight from the active file that is supposed to be a transcipt
		const ribbonIconEl = this.addRibbonIcon('brain-circuit', 'Generate insights', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Generate insights');
			// get current file name and path in the active editor
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice('No active file');
				return;
			}
			// get the content of the active file
			const activeFileText = this.app.vault.cachedRead(activeFile).then(
				(data) => {
					console.log(data);

					const post_processor = new TranscriptionPostProcessor(this);
					post_processor.process(data).then((insights : string) => {
						// insert the insights at the top of the activeFile
						this.app.vault.modify(activeFile, "# insights\n" + insights + "\n# original transcript\n" + data);
					});
				});			


		})


		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Transcribing Off');

		this.languageBarItemEl = this.addStatusBarItem()
		this.languageBarItemEl.setText('Transcribing langugage (' + this.currentLanguage + ')');

		// this create an icon on the left ribbon to choose the language of the audio
		const ribbonIconElLangugage = this.addRibbonIcon('languages', 'Choose language', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Choose language');
			const languageModal = new LanguageModal(this.app, this);
			languageModal.open();
		})

		// This creates an icon in the left ribbon.
		const ribbonIconElStart = this.addRibbonIcon('circle', 'Start tanscribing', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Start transcribing');
			this.isTranscribing = true;
			statusBarItemEl.setText('Transcribing On');
			// get current file name and path in the active editor
			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) {
				new Notice('No active file');
				return;
			}
			const activeFilePath = activeFile.path;
			const activeFileName = activeFile.basename;
			const activeFileNameWithExtension = activeFile.name;
			// create a new file in a subfolder called transcriptions with the same name as the active file
			const newFilePath = activeFilePath.replace(activeFileNameWithExtension, 'transcriptions/' + activeFileNameWithExtension);
			// create the new file if it doesn't exist
			const file = this.app.vault.getAbstractFileByPath(newFilePath)
			if (file) {
				new Notice('File already exists: ' + newFilePath);
				this.startTranscription(newFilePath);
				return;
			} else {
				new Notice('Creating new file: ' + newFilePath);
				// create the folder if it doesn't exist
				if (this.app.vault.getAbstractFileByPath(activeFilePath.replace(activeFileNameWithExtension, 'transcriptions'))) {
					new Notice('Folder already exists: ' + activeFilePath.replace(activeFileNameWithExtension, 'transcriptions'));
					this.startTranscription(newFilePath);

				} else {
					this.app.vault.createFolder(activeFilePath.replace(activeFileNameWithExtension, 'transcriptions')).then(
						(value) => {
							new Notice('Folder created: ' + value);
							this.startTranscription(newFilePath);
						}
					);
				}
				
			}
		});
		const ribbonIconElStop = this.addRibbonIcon('square', 'Stop transcribing', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('Stop transcribing');
			this.isTranscribing = false;
			statusBarItemEl.setText('Transcribing Off');
			// kill the transcription process
			const pid = this.transcriptionPid;
			if (pid) {
				if (pid > 0) {
					process.kill(pid);
					new Notice('Transcription process killed');
					this.transcriptionPid = 0;
				}
			}
		});		



		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async startTranscription(transcriptionFilePath : string) {
		console.log('startTranscription');
		this.app.vault.create(transcriptionFilePath, '').then(
			(value) => {
				new Notice('New file created: ' + transcriptionFilePath);
				this.transcriptionFile = value;
				// open the new file in the active editor
				this.app.workspace.getLeaf(true).openFile(value);
				// add a first line to the file
				this.app.vault.modify(value, 'Transcription started at ' + new Date().toLocaleString() + '\n');

				// start the transcription
				const whisperPath = this.settings.whisperPath;
				const whipserModel = this.settings.whipserModel;
				const audioDeviceId = this.settings.audioDeviceId;

				transcriptionFilePath = this.vaultPath + transcriptionFilePath;
				// -f "${transcriptionFilePath}"
				const command = `"${whisperPath}/stream" -m "${whipserModel}" --capture ${audioDeviceId} -l ${this.currentLanguage}  -t 4 --step 0 --length 30000 -vth 0.6`
				console.log(command);				
				const record_directory = transcriptionFilePath.split("/").slice(0,-1).join('/')
				console.log("record_directory",record_directory)		
				process.chdir(record_directory);
				var currentPath = process.cwd();
				console.log("currentPath",currentPath)		
				const child = require('child_process').exec(command, {cwd: record_directory});
				//const child = require('child_process').exec(command);
				child.stdout.on('data', (data: any) => {
					console.log(data);

					// transfrom this output to absolut time since the begining of the recording
					const lines = data.split('\n');
					// use regex to extract transcription start (t0) and end (t1)
					if (lines[1].match(/t0 = (\d+) ms/)){
						const transcriptionStart = lines[1].match(/t0 = (\d+) ms/)[1];
						const transcriptionEnd = lines[1].match(/t1 = (\d+) ms/)[1];
	
						console.log(transcriptionStart);
						console.log(transcriptionEnd);
						const transcription = lines.filter((line: string) => line.startsWith('[')).join('\n');
						console.log(transcription);
						// transform time to absolute time since the begining of the recording
						const transcriptionStartMs = Number(transcriptionStart).valueOf();
						const transcriptionEndMs = Number(transcriptionEnd).valueOf();
						
						// loop on transcription
						const transcriptionLines = transcription.split('\n');
						transcriptionLines.forEach((transcriptionLine: string) => {
							// update the start of line with absolute time values
							// [00:00:00.000 --> 00:00:03.360]
							
							const timeMatch = transcriptionLine.match(/\[(\d+:\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+)\]\s*(.*)/)
							if (timeMatch) {
								const start = timeMatch[1];
								const end = timeMatch[2];
								const transcriptionLineText = timeMatch[3];
								// time format in each timeMatch element is hh:mm:ss.ms
								const startMs = timestampToMs(start)
								const endMs = timestampToMs(end);
								const absoluteStart = msToTimestamp(transcriptionStartMs + startMs);
								const absoluteEnd = msToTimestamp(transcriptionStartMs + endMs);
								// update the start of line with absolute time values
								// [00:00:00.000 --> 00:00:03.360]
								const newLine = `[${absoluteStart} --> ${absoluteEnd}] ${transcriptionLineText}`;
								console.log(newLine);
								// append the new line to the TFile value
								this.app.vault.append(this.transcriptionFile,newLine + '\n');
							}
						})
					}

				})
				child.stderr.on('data', (data: any) => {
					console.log(data);
				})
				child.on('close', (code: any) => {
					console.log(`child process exited with code ${code}`);
					const post_processor = new TranscriptionPostProcessor(this);
					// clean up the transcript
					const transcription = this.app.vault.read(this.transcriptionFile).then((value : string) => {						
						const processedTranscription = post_processor.cleanUpTranscript(value);
						console.log(processedTranscription);
						// write the processed transcription to the TFile
						this.app.vault.modify(this.transcriptionFile, processedTranscription);

					});


				})
				this.transcriptionPid = child.pid;		

			});

	}

	async startTranscriptionWithTimeStampVAD(transcriptionFilePath : string) {
		console.log('startTranscription');
		this.app.vault.create(transcriptionFilePath, '').then(
			(value) => {
				new Notice('New file created: ' + transcriptionFilePath);
				this.transcriptionFile = value;
				// open the new file in the active editor
				this.app.workspace.getLeaf(true).openFile(value);
				// add a first line to the file
				this.app.vault.modify(value, 'Transcription started at ' + new Date().toLocaleString() + '\n');

				// start the transcription
				const whisperPath = this.settings.whisperPath;
				const whipserModel = this.settings.whipserModel;
				const audioDeviceId = this.settings.audioDeviceId;
				// escape characters in transcriptionFilePath to be compatible with bash scripts
				transcriptionFilePath = (this.vaultPath + transcriptionFilePath).replace(/"/g, '\\"');
				// -f "${transcriptionFilePath}"
				const command = `"${whisperPath}/stream" -m "${whipserModel}" --capture ${audioDeviceId}  -t 6 --step 0 --length 30000 -vth 0.6`
				console.log(command);
				const record_directory = transcriptionFilePath.split(".md")[0]
				console.log(record_directory)
				// run the command in the same directory as the transcriptionFilePath
				
				const child = require('child_process').exec(command, {cwd: transcriptionFilePath.split(".md")[0]});
				//const child = require('child_process').exec(command);
				child.stdout.on('data', (data: any) => {
					console.log(data);
					// each block of 30 of audio is transcribed as follow
					// with a start and an end block 
					// then each line indicate the relative time of the relevant audio and its transcription
					// ### Transcription 11 START | t0 = 92986 ms | t1 = 122986 ms
					// [00:00:00.000 --> 00:00:03.360]   this session here is that you will leave this session,
					// [00:00:03.360 --> 00:00:07.720]   preferably at the end, with an idea of how you can find things
					// [00:00:07.720 --> 00:00:10.380]   you can optimize and how you can improve it.
					// [00:00:10.380 --> 00:00:15.820]   Optimization for resource efficiency is nothing new.
					// [00:00:15.820 --> 00:00:18.960]   I think it's safe to say that architects and developers
					// [00:00:18.960 --> 00:00:24.100]   and you are celebrating optimizing response time,
					// [00:00:24.100 --> 00:00:26.980]   shaving off a few seconds of a response time of the build
					// [00:00:26.980 --> 00:00:30.000]   process of the deployment process.
					// ### Transcription 11 END
					// transfrom this output to absolut time since the begining of the recording
					const lines = data.split('\n');
					// use regex to extract transcription start (t0) and end (t1)
					console.log(`first line that should contain start and end time\n ${lines[1]}`)
					if (lines[1].match(/t0 = (\d+) ms/)){
						const transcriptionStart = lines[1].match(/t0 = (\d+) ms/)[1];
						const transcriptionEnd = lines[1].match(/t1 = (\d+) ms/)[1];
	
						console.log(transcriptionStart);
						console.log(transcriptionEnd);
						const transcription = lines.filter((line: string) => line.startsWith('[')).join('\n');
						console.log(transcription);
						// transform time to absolute time since the begining of the recording
						const transcriptionStartMs = Number(transcriptionStart).valueOf();
						const transcriptionEndMs = Number(transcriptionEnd).valueOf();
						
						// loop on transcription
						const transcriptionLines = transcription.split('\n');
						transcriptionLines.forEach((transcriptionLine: string) => {
							// update the start of line with absolute time values
							// [00:00:00.000 --> 00:00:03.360]
							
							const timeMatch = transcriptionLine.match(/\[(\d+:\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+)\]\s*(.*)/)
							if (timeMatch) {
								const start = timeMatch[1];
								const end = timeMatch[2];
								const transcriptionLineText = timeMatch[3];
								// time format in each timeMatch element is hh:mm:ss.ms
								const startMs = timestampToMs(start)
								const endMs = timestampToMs(end);
								const absoluteStart = msToTimestamp(transcriptionStartMs + startMs);
								const absoluteEnd = msToTimestamp(transcriptionStartMs + endMs);
								// update the start of line with absolute time values
								// [00:00:00.000 --> 00:00:03.360]
								const newLine = `[${absoluteStart} --> ${absoluteEnd}] ${transcriptionLineText}`;
								console.log(newLine);
								// append the new line to the TFile value
								this.app.vault.append(this.transcriptionFile,newLine + '\n');
							}
						})
	
					}

				})
				child.stderr.on('data', (data: any) => {
					console.log(data);
				})
				child.on('close', (code: any) => {
					console.log(`child process exited with code ${code}`);
				})
				this.transcriptionPid = child.pid;		

			});

	}



}


export function timestampToMs(timestamp:string) : number {
	const [hours, minutes, seconds] = timestamp.split(':');
	const [seconds_only,ms] = seconds.split('.');
	const total_ms = Number(ms) + Number(seconds_only) * 1000 + Number(minutes) * 60000 + Number(hours) * 3600000;
	return total_ms.valueOf();
}

export function msToTimestamp(ms:number) {	
	const hours = Math.floor(ms / 3600000);
	const minutes = Math.floor((ms % 3600000) / 60000);
	const seconds = Math.floor(((ms % 3600000) % 60000) / 1000);
	const milliseconds = ms % 1000;
	// format the time to hh:mm:ss.ms
	// with 2 characters for hours, minutes and seconds
	// with 3 charatcers for ms
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
}


const ALL_LANGUAGES = [
	'en',
	'fr',
]

class LanguageModal extends SuggestModal<String> {
	plugin: MyPlugin;

	getSuggestions(query: string): String[] | Promise<String[]> {
		const suggestions = ALL_LANGUAGES.filter(lang => lang.toLowerCase().startsWith(query.toLowerCase()));
		return suggestions;
	}
	renderSuggestion(suggestion: String, el: HTMLElement) {
		el.setText(suggestion.valueOf());
	}
	constructor(app: App, plugin : MyPlugin) {
		super(app);
		this.setPlaceholder('Enter a language');
		this.plugin = plugin;
	}

	onChooseSuggestion(item: String, evt: MouseEvent | KeyboardEvent) {
		this.plugin.setCurrentLanguage(item.valueOf());
	}

	onChooseItem(item: string, _: MouseEvent) {
		console.log(`Selected item: ${item}`);
	}	
}


class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		new Setting(containerEl)
			.setName('Whisper model path')
			.setDesc('The ggml model used to transcribe')
			.addText(text => text
				.setPlaceholder('models/ggml-large-v3.bin')
				.setValue(this.plugin.settings.whipserModel)
				.onChange(async (value) => {
					this.plugin.settings.whipserModel = value;
					await this.plugin.saveSettings();
				}));


		new Setting(containerEl)
			.setName('Whisper path')
			.setDesc('Where whisper.cpp is installed')
			.addText(text => text
				.setPlaceholder('Enter your path')
				.setValue(this.plugin.settings.whisperPath)
				.onChange(async (value) => {
					this.plugin.settings.whisperPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Audio device')
			.setDesc('The audio device index to record')
			.addText(text => text
				.setPlaceholder('2')
				.setValue(String(this.plugin.settings.audioDeviceId))
				.onChange(async (value) => {
					this.plugin.settings.audioDeviceId = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('LLama.cpp OpenAI comptible URL')
			.setDesc('The LLama.cpp OpenAI comptible URL')
			.addText(text => text
				.setPlaceholder('http://localhost:8000/v1')
				.setValue(String(this.plugin.settings.llamaUrl))
				.onChange(async (value) => {
					this.plugin.settings.llamaUrl = value;
					await this.plugin.saveSettings();
				}));				

		new Setting(containerEl)
			.setName('LLama.cpp LLM model name')
			.setDesc('The LLama.cpp LLM model name')
			.addText(text => text
				.setPlaceholder('capybarahermes-2.5-mistral-7b')
				.setValue(String(this.plugin.settings.llamaLLM))
				.onChange(async (value) => {
					this.plugin.settings.llamaLLM = value;
					await this.plugin.saveSettings();
				}));								
	}
}
