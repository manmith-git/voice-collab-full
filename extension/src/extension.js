
const vscode = require('vscode');

function activate(context){
  context.subscriptions.push(
    vscode.commands.registerCommand("voicecollab.start", () => {
      const room = Date.now().toString();
      const server = "https://voice-collab-room.onrender.com";

      const panel = vscode.window.createWebviewPanel(
        "voicecollab",
        "Voice Collab",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = `
      <html><body style="margin:0">
      <iframe 
        src="${server}/editor.html?room=${room}" 
        style="width:100%; height:100%; border:0">
      </iframe>
      </body></html>`;

      vscode.env.openExternal(
        vscode.Uri.parse(`${server}/mic.html?room=${room}`)
      );
    })
  );
}

exports.activate = activate;
