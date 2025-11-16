const vscode = require('vscode');

let currentSession = null;
let statusBarItem = null;

function activate(context) {
  console.log('Voice Collab extension is now active');

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(broadcast-off) Voice Collab";
  statusBarItem.command = 'voicecollab.showMenu';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Show menu command
  context.subscriptions.push(
    vscode.commands.registerCommand('voicecollab.showMenu', async () => {
      if (currentSession) {
        const action = await vscode.window.showQuickPick([
          'Copy Room ID',
          'Share Current File',
          'Toggle Microphone',
          'Leave Session'
        ], { placeHolder: 'Voice Collab Actions' });

        switch (action) {
          case 'Copy Room ID':
            vscode.env.clipboard.writeText(currentSession.roomId);
            vscode.window.showInformationMessage(`Room ID copied: ${currentSession.roomId}`);
            break;
          case 'Share Current File':
            shareCurrentFile();
            break;
          case 'Leave Session':
            leaveSession();
            break;
        }
      } else {
        const action = await vscode.window.showQuickPick([
          'Start Hosting Session',
          'Join Session'
        ], { placeHolder: 'Voice Collab' });

        if (action === 'Start Hosting Session') {
          vscode.commands.executeCommand('voicecollab.startHost');
        } else if (action === 'Join Session') {
          vscode.commands.executeCommand('voicecollab.joinSession');
        }
      }
    })
  );

  // Start Host Command
  context.subscriptions.push(
    vscode.commands.registerCommand('voicecollab.startHost', async () => {
      if (currentSession) {
        vscode.window.showWarningMessage('Already in a session');
        return;
      }

      const roomId = generateRoomId();
      const server = "https://voice-collab-room.onrender.com";

      try {
        // Create session
        currentSession = {
          roomId,
          server,
          isHost: true,
          socket: null,
          ydoc: new Y.Doc(),
          panel: null
        };

        // Connect Socket.IO
        currentSession.socket = io(server, {
          transports: ['websocket']
        });

        currentSession.socket.on('connect', () => {
          console.log('Connected to server');
          currentSession.socket.emit('join-room', roomId);
          
          statusBarItem.text = `$(broadcast) Hosting: ${roomId}`;
          statusBarItem.tooltip = `Room ID: ${roomId} (Click for actions)`;
        });

        currentSession.socket.on('user-joined', (userId) => {
          vscode.window.showInformationMessage(
            `User ${userId.substring(0, 8)} joined your session`
          );
        });

        // Create webview panel for editor
        currentSession.panel = vscode.window.createWebviewPanel(
          'voicecollab',
          `Voice Collab - Room: ${roomId}`,
          vscode.ViewColumn.Beside,
          { enableScripts: true }
        );

        currentSession.panel.webview.html = getWebviewContent(server, roomId, true);

        // Handle panel close
        currentSession.panel.onDidDispose(() => {
          if (currentSession && !currentSession.isClosing) {
            leaveSession();
          }
        });

        // Open mic in browser
        vscode.env.openExternal(
          vscode.Uri.parse(`${server}/mic.html?room=${roomId}`)
        );

        // Show success message with actions
        const action = await vscode.window.showInformationMessage(
          `Session started! Room ID: ${roomId}`,
          'Copy ID',
          'Share Active File',
          'Open Mic'
        );

        if (action === 'Copy ID') {
          vscode.env.clipboard.writeText(roomId);
          vscode.window.showInformationMessage('Room ID copied!');
        } else if (action === 'Share Active File') {
          shareCurrentFile();
        } else if (action === 'Open Mic') {
          vscode.env.openExternal(
            vscode.Uri.parse(`${server}/mic.html?room=${roomId}`)
          );
        }

        // Watch for file changes if host
        setupFileWatcher();

      } catch (err) {
        vscode.window.showErrorMessage(`Failed to start session: ${err.message}`);
        currentSession = null;
      }
    })
  );

  // Join Session Command
  context.subscriptions.push(
    vscode.commands.registerCommand('voicecollab.joinSession', async () => {
      if (currentSession) {
        vscode.window.showWarningMessage('Already in a session');
        return;
      }

      const roomId = await vscode.window.showInputBox({
        prompt: 'Enter Room ID',
        placeHolder: 'e.g., ABC123',
        validateInput: (value) => {
          return value && value.length > 0 ? null : 'Room ID is required';
        }
      });

      if (!roomId) {
        return;
      }

      const server = "https://voice-collab-room.onrender.com";

      try {
        // Create session
        currentSession = {
          roomId,
          server,
          isHost: false,
          socket: null,
          ydoc: new Y.Doc(),
          panel: null
        };

        // Connect Socket.IO
        currentSession.socket = io(server, {
          transports: ['websocket']
        });

        currentSession.socket.on('connect', () => {
          console.log('Connected to server');
          currentSession.socket.emit('join-room', roomId);
          
          statusBarItem.text = `$(plug) Joined: ${roomId}`;
          statusBarItem.tooltip = `Connected to room ${roomId}`;
        });

        // Create webview panel
        currentSession.panel = vscode.window.createWebviewPanel(
          'voicecollab',
          `Voice Collab - Room: ${roomId}`,
          vscode.ViewColumn.Beside,
          { enableScripts: true }
        );

        currentSession.panel.webview.html = getWebviewContent(server, roomId, false);

        // Handle panel close
        currentSession.panel.onDidDispose(() => {
          if (currentSession && !currentSession.isClosing) {
            leaveSession();
          }
        });

        // Open mic in browser
        vscode.env.openExternal(
          vscode.Uri.parse(`${server}/mic.html?room=${roomId}`)
        );

        vscode.window.showInformationMessage(
          `Joined room ${roomId}. Waiting for host to share files...`
        );

      } catch (err) {
        vscode.window.showErrorMessage(`Failed to join session: ${err.message}`);
        currentSession = null;
      }
    })
  );

  context.subscriptions.push(statusBarItem);
}

function setupFileWatcher() {
  if (!currentSession || !currentSession.isHost) return;

  // Watch active editor changes
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && currentSession && currentSession.isHost) {
      const autoShare = vscode.workspace
        .getConfiguration('voicecollab')
        .get('autoShareActiveFile', false);
      
      if (autoShare) {
        shareFile(editor.document);
      }
    }
  });

  // Watch document changes
  vscode.workspace.onDidChangeTextDocument((event) => {
    if (currentSession && currentSession.isHost && currentSession.activeDoc === event.document) {
      // Sync changes through YJS
      syncDocumentChanges(event);
    }
  });
}

function shareCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active file to share');
    return;
  }

  if (!currentSession || !currentSession.isHost) {
    vscode.window.showErrorMessage('Only host can share files');
    return;
  }

  shareFile(editor.document);
}

function shareFile(document) {
  if (!currentSession) return;

  const filename = document.fileName.split(/[\\/]/).pop();
  const content = document.getText();
  const language = document.languageId;

  // Send file info through socket
  currentSession.socket.emit('share-file', {
    room: currentSession.roomId,
    filename,
    content,
    language
  });

  currentSession.activeDoc = document;

  vscode.window.showInformationMessage(`Sharing: ${filename}`);
}

function syncDocumentChanges(event) {
  // Sync incremental changes through YJS
  // This will sync typing in real-time
  const changes = event.contentChanges;
  if (changes.length > 0 && currentSession) {
    const ytext = currentSession.ydoc.getText('code');
    
    changes.forEach(change => {
      const start = change.rangeOffset;
      const deleteLength = change.rangeLength;
      const insertText = change.text;

      if (deleteLength > 0) {
        ytext.delete(start, deleteLength);
      }
      if (insertText.length > 0) {
        ytext.insert(start, insertText);
      }
    });
  }
}

function leaveSession() {
  if (!currentSession) return;

  currentSession.isClosing = true;

  if (currentSession.socket) {
    currentSession.socket.disconnect();
  }

  if (currentSession.panel) {
    currentSession.panel.dispose();
  }

  const wasHost = currentSession.isHost;
  currentSession = null;

  statusBarItem.text = "$(broadcast-off) Voice Collab";
  statusBarItem.tooltip = "Click to start or join session";

  vscode.window.showInformationMessage(
    wasHost ? 'Session ended' : 'Left session'
  );
}

function getWebviewContent(server, room, isHost) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    iframe { width: 100%; height: 100vh; border: 0; }
    .header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #1e1e1e;
      color: #fff;
      padding: 10px;
      font-family: system-ui;
      z-index: 1000;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .room-id {
      font-family: monospace;
      background: #2d2d2d;
      padding: 4px 8px;
      border-radius: 4px;
    }
    .badge {
      background: ${isHost ? '#28a745' : '#007acc'};
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
    iframe { margin-top: 40px; height: calc(100vh - 40px); }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <span class="badge">${isHost ? 'HOST' : 'PARTICIPANT'}</span>
      Room: <span class="room-id">${room}</span>
    </div>
    <div style="font-size: 12px;">
      ${isHost ? '🎙️ Hosting session' : '🎙️ Connected to host'}
    </div>
  </div>
  <iframe src="${server}/editor.html?room=${room}"></iframe>
</body>
</html>`;
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function deactivate() {
  leaveSession();
}

module.exports = { activate, deactivate };