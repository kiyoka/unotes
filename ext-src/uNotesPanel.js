"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const os = require("os");
const { Config, Utils } = require("./uNotesCommon");

let _currentPanel = null;

class UNotesPanel {

    static async createOrShow(extensionPath) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (_currentPanel) {
            _currentPanel.panel.reveal(column, false);
        } else {
            _currentPanel = new UNotesPanel(extensionPath, column || vscode.ViewColumn.One);
            await _currentPanel.initialize();
        }
    }

    static close() {
        try {
            _currentPanel.dispose();
            _currentPanel = null;
        } catch (e) {
            console.log(e);
        }
    }

    static async recreate(extensionPath, currentNote) {
        try {
            UNotesPanel.close();
            await UNotesPanel.createOrShow(extensionPath);
            if (currentNote) {
                await _currentPanel.showUNote(currentNote);
            }
        } catch (e) {
            console.log(e);
        }
    }

    static instance() {
        return _currentPanel;
    }

    constructor(extensionPath, column) {
        try {
            this.extensionPath = extensionPath;
            this.disposables = [];
            this.reloadContentNeeded = false;
            this.updateSettingsNeeded = false;
            this.currentPath = '';
            this.savedContent = {};
            this.currentNote = null;
            this.imageToConvert = null;
            this.imageToReplace = null;
            let localResourceRoots = [
                vscode.Uri.file(path.join(Config.rootPath)),
                vscode.Uri.file(path.join(this.extensionPath, 'build'))
            ]
            if (Config.mediaFolder.startsWith('/')) {
                localResourceRoots.push(vscode.Uri.file(Config.mediaFolder))
            }
            this.panel = vscode.window.createWebviewPanel('unotes', "UNotes", { viewColumn: vscode.ViewColumn.column, preserveFocus: false }, {
                enableScripts: true,
                retainContextWhenHidden: true,
                enableFindWidget: true,
                localResourceRoots: localResourceRoots
            });

            // Set the webview's initial html content
            this.panel.webview.html = this.getWebviewContent();

            // Listen for when the panel is disposed
            // This happens when the user closes the panel or when the panel is closed programatically
            this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

            // Handle messages from the webview
            this.panel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'applyChanges':
                        // kind of a hack to replace pasted images with actual files
                        if (this.imageToReplace){
                            const newContent = await this.replaceImage(message.content, this.imageToReplace);
                            if(newContent){     // will be empty on error
                                message.content = newContent;
                            }
                        }
                        else if (this.imageToConvert){
                            const newContent = await this.convertImage(message.content, this.imageToConvert);
                            if(newContent){     // will be empty on error
                                message.content = newContent;
                            }
                        }
                        await this.saveChanges(message.content);
                        if (this.imageToReplace){
                            this.imageToReplace = null;
                            await this.updateContents(true);
                        }
                        else if (this.imageToConvert){
                            this.imageToConvert = null;  
                            await this.updateContents(true);
                        }
                        break;
                    case 'editorOpened':
                        await this.updateContents(true);
                        this.updateEditorSettings();
                        await this.updateRemarkSettings();
                        break;
                    case 'resized':
                        await UNotesPanel.recreate(this.extensionPath, this.currentNote);
                        break;
                    case 'convertImage':
                        const imageFilePath = Utils.toLowerCaseDriveLetter(path.normalize(message.path));
                        const imageDirPath = path.dirname(imageFilePath)
                        let mediaFolderFullPath = Utils.toLowerCaseDriveLetter(path.normalize(this.getMediaFolderFullPath()));
                        if ((os.platform() === 'win32') && !mediaFolderFullPath.startsWith(':',1)) { // for Windows Platform
                            mediaFolderFullPath = "c:" + mediaFolderFullPath;
                        }
                        //console.log('imageFilePath', imageFilePath);
                        //console.log('imageDirPath', imageDirPath);
                        //console.log('mediaFolderFullPath', mediaFolderFullPath);
                        if (imageDirPath.startsWith(mediaFolderFullPath)) {
                            let pathInMediaFolder = imageFilePath.substring(mediaFolderFullPath.length);
                            this.imageToReplace = {
                                base64: message.data,
                                imagePath: Utils.getImageTagUrl(pathInMediaFolder)
                            }
                        }
                        else {
                            this.imageToConvert = message.data;
                        }
                        break;
                    default:
                        console.log("Unknown webview message received:")
                        console.log(message)
                }
            }, null, this.disposables);

            this.panel.onDidChangeViewState(async e => {
                if (e.webviewPanel.active) {
                    if (this.reloadContentNeeded) {
                        await this.updateContents(true);
                        this.reloadContentNeeded = false;
                    }
                    if (this.updateSettingsNeeded) {
                        this.updateEditorSettings();
                        this.updateSettingsNeeded = false;
                    }
                }
            }, null, this.disposables);

            // Register commands
            this.disposables.push(vscode.commands.registerCommand("unotes.heading.1", () => {
                this.hotkeyExec(['heading', {level: 1}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.heading.2", () => {
                this.hotkeyExec(['heading', {level: 2}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.heading.3", () => {
                this.hotkeyExec(['heading', {level: 3}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.heading.4", () => {
                this.hotkeyExec(['heading', {level: 4}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.heading.5", () => {
                this.hotkeyExec(['heading', {level: 5}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.heading.6", () => {
                this.hotkeyExec(['heading', {level: 6}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.normal", () => {
                this.hotkeyExec(['heading', {level: 0}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.bold", () => {
                this.hotkeyExec(['bold', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.italic", () => {
                this.hotkeyExec(['italic', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.strike", () => {
                this.hotkeyExec(['strike', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.task", () => {
                this.hotkeyExec(['taskList', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.ul", () => {
                this.hotkeyExec(['bulletList', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.ol", () => {
                this.hotkeyExec(['orderedList', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.blockquote", () => {
                this.hotkeyExec(['blockQuote', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.code", () => {
                this.hotkeyExec(['code', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.codeblock", () => {
                this.hotkeyExec(['codeBlock', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.indent", () => {
                this.hotkeyExec(['indent', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.outdent", () => {
                this.hotkeyExec(['outdent', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.hr", () => {
                this.hotkeyExec(['hr', {}]);
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.toggleMode", () => {
                this.toggleEditorMode();
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.insertTemplate", () => {
                this.insertTemplate();
            }));
            this.disposables.push(vscode.commands.registerCommand("unotes.focus", () => {
                this.focus();
            }));
            this.disposables.push(vscode.window.onDidChangeActiveColorTheme(this.updateColorTheme.bind(this)));

            Utils.context.subscriptions.push(Config.onDidChange_editor_settings(this.updateEditorSettings.bind(this)));
            this.updateEditorSettings();

        }
        catch (e) {
            console.log(e);
        }

    }

    async initialize() {
        await this.updateRemarkSettings();
    }

    updateColorTheme(e) {
        UNotesPanel.recreate(this.extensionPath, this.currentNote);
    }

    focus() {
        if (this.panel.active) {
            this.panel.webview.postMessage({ command: 'focus' });
        }
    }

    updateEditorSettings() {
        if (this.panel.active) {
            this.panel.webview.postMessage({ command: 'settings', settings: Config.settings.get('editor') });

        } else {
            this.updateSettingsNeeded = true;
        }
    }

    async updateRemarkSettings() {
        const remarkSettingsFile = 'remark_settings.json';
        const remarkSettingsCommand = 'remarkSettings';
        const fp = path.join(Config.folderPath, remarkSettingsFile);
        if (await Utils.fileExists(fp)){
            try {
                const decoder = new TextDecoder();
                const data = decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.file(fp)));
                const obj = JSON.parse(data);
                this.panel.webview.postMessage({ command: remarkSettingsCommand, settings: obj });
                return;
            
            } catch(e){
                const msg = e.message;
                console.log(msg);
                await vscode.window.showWarningMessage("Failed to load remark_settings.json file. \nNo Unotes remark formatting will be done.");
            }
        }
            this.panel.webview.postMessage({ command: remarkSettingsCommand, settings: null });
    }

    hotkeyExec(args) {
        if (this.panel.active) {
            this.panel.webview.postMessage({ command: 'exec', args });
        }
    }

    toggleEditorMode() {
        if (this.panel.active) {
            this.panel.webview.postMessage({ command: 'toggleMode'});
        }
    }

    async imageMaxWidth(percent) {
        if (this.panel.active) {
            this.panel.webview.postMessage({ command: 'imageMaxWidth', percent});
        }
        await this.updateContents(true);
    }

    insertTemplate() {
        // todo
    }

    async saveChanges(content) {
        
        if (this.currentPath) {
            this.writingFile = this.currentPath;
            this.savedContent[ this.currentPath ] = content;
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(vscode.Uri.file(this.currentPath), encoder.encode(content));
        }
    }

    async showUNote(unote) {
        try {
            const filePath = unote.fullPath();
            this.currentNote = unote;
            this.currentPath = filePath;
            await this.updateContents(true);
            const title = unote.label;
            this.panel.title = 'Unotes - ' + title;
        }
        catch (e) {
            console.log(e);
        }
    }

    calcHash(content) {
        const shasum = crypto.createHash('sha1');
        shasum.update(content);
        let hash = shasum.digest('hex');
        return hash;
    }

    async updateContents(force) {
        try {
            if(this.currentNote){
                const decoder = new TextDecoder();
                const content = decoder.decode(await vscode.workspace.fs.readFile(vscode.Uri.file(this.currentPath)));
                let fileHash = this.calcHash(content);
                let savedHash = '';
                if(this.savedContent[ this.currentPath ]) {
                    savedHash = this.calcHash(this.savedContent[ this.currentPath ]);
                }
                //console.log('fileHash', fileHash);
                //console.log('saveHash', savedHash);
                //console.log('force',force);
                if(force) {
                    savedHash = '';
                }
                const folderPath = this.panel.webview.asWebviewUri(vscode.Uri.file(path.join(Config.rootPath, this.currentNote.folderPath))).path;
                this.panel.webview.postMessage({ command: 'setContent', content, fileHash, savedHash, folderPath, contentPath: this.currentPath, percent: Config.imageMaxWidthPercent })
            }
        }
        catch (e) {
            console.log(e);
        }
    }

    getNoteFolderFullPath() {
        const noteFolderFullPath = path.join(Config.rootPath, this.currentNote.folderPath);
        return noteFolderFullPath
    }

    getMediaFolderFullPath() {
        if (Config.mediaFolder.startsWith('/')) {
            return Config.mediaFolder;
        }
        const noteFolderFullPath = this.getNoteFolderFullPath();
        return path.join(noteFolderFullPath, Config.mediaFolder);
    }

    /**
     * Removes the given image data from the content, 
     * saves an image, puts a relative image path in its place
     * @returns the new content, or blank if a failure happends
     */
     async convertImage(content, image) {
        try {
            if(this.currentNote){
                const noteFolder = this.getNoteFolderFullPath();
                let found = 0;

                // get a unique image index
                let index = await Utils.getNextImageIndex(noteFolder);
    
                // replace the embedded image with a relative file
                const imgBuffersTypes = [];     // [[buffer, index, type]]

                let newContent = content.replace(image, (d) => {
                    let match = /data:image\/(.*);base64,(.*)$/g.exec(d);

                    if(match){
                        // write the file
                        const fname = Utils.getImageName(index, match[1]);
                        imgBuffersTypes.push([new Buffer.from(match[2], 'base64'), index++, match[1]]);

                        found++;
                        // replace the content with the the relative path
                        return Utils.getImageTagUrl(fname);
                    }
                    return '';  // failed
                });

                for (const img of imgBuffersTypes){
                    await Utils.saveMediaImage(noteFolder, img[0], img[1], img[2]);
                }
                
                if(found > 0){
                    return newContent;
                }
                return content;
            }
        }
        catch(e){
            console.log(e);
        }
        return content;
    }
    
    /**
     * Replace the given image data with image path.
     * @returns the new content text
     */
    async replaceImage(content, imageObj) {
        try {
            if (this.currentNote) {
                // replace the embedded image with a imagePath
                const newContent = content.replace(imageObj.base64, imageObj.imagePath);
                return newContent;
            }
        }
        catch (e) {
            console.log(e);
        }
        return content;
    }

    async updateFileIfOpen(filePath) {
        // update our view if an external change happens
        if ((this.currentPath == filePath) && (filePath != this.writingFile)) {
            // if the view is active then load now else flag to reload on showing
            if (this.panel.active) {
                await this.updateContents(false);
            } else {
                this.reloadContentNeeded = true;
            }
            return true;
        }
        this.writingFile = '';
        return false;
    }

    async switchIfOpen(oldNote, newNote) {
        if (this.currentPath == oldNote.fullPath()) {
            await this.showUNote(newNote);
        }
    }

    closeIfOpen(filePath) {
        if (filePath == this.currentPath) {
            UNotesPanel.close();
        }
    }
    
    async checkCurrentFile(){
        if(!await Utils.fileExists(this.currentPath)) {
            UNotesPanel.close();
        }
    }

    dispose() {
        _currentPanel = undefined;

        // Clean up our resources
        this.panel.dispose();

        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    getNonce() {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    getWebviewContent() {
        const mainScript = '/static/js/main.js';
        const mainStyle = '/static/css/main.css';

        const scriptPathOnDisk = vscode.Uri.file(path.join(this.extensionPath, 'build', mainScript));
        const scriptUri = this.panel.webview.asWebviewUri(scriptPathOnDisk);
        const stylePathOnDisk = vscode.Uri.file(path.join(this.extensionPath, 'build', mainStyle));
        const styleUri = this.panel.webview.asWebviewUri(stylePathOnDisk);
        const baseUri = this.panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.extensionPath, 'build')));

        // Use a nonce to whitelist which scripts can be run
        const nonce = this.getNonce();
        //<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https: data:; script-src 'nonce-${nonce}' 'unsafe-inline' 'unsafe-eval' vscode-resource: data:;style-src vscode-resource: 'unsafe-inline' http: https: data:;">

        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta name="theme-color" content="#000000">
				<title>UNotes</title>
				<link rel="stylesheet" type="text/css" href="${styleUri}">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: vscode-webview-resource: ${this.panel.webview.cspSoure} http: https: data:; script-src 'unsafe-inline' 'unsafe-eval' vscode-resource: data:; font-src 'unsafe-inline' 'unsafe-eval' vscode-resource: data:; style-src vscode-resource: 'unsafe-inline' http: https: data:;">
				<base href="${baseUri}/">
			</head>

			<body class="unotes-common">
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <script>
          (function() {
            window.vscode = acquireVsCodeApi();
          }())
        </script>
				<div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
    }

}
exports.UNotesPanel = UNotesPanel;
