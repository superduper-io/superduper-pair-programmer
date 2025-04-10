import * as vscode from 'vscode';
import { WebSocket } from 'ws';

export function activate(context: vscode.ExtensionContext) {
    console.log("Activating the extension...");

    // Existing listener for saved documents
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        vscode.window.showInformationMessage('Document saved: ' + document.fileName);
    }));

    // Setup WebSocket connection
    const serverUrl = 'ws://localhost:8765';
    const socket = new WebSocket(serverUrl);

    //    The handler can be empty if you don’t plan on responding to user commands.
    const reviewBot = vscode.chat.createChatParticipant(
            'review-bot',
            async (_request, _chatContext, _stream, _token) => {
                // No-op or minimal. If the user types @review-bot and hits enter, you'd handle it here.
            }
        );
    reviewBot.iconPath = new vscode.ThemeIcon('comment-discussion'); // or any icon
    context.subscriptions.push(reviewBot);

    socket.onopen = function(event) {
        console.log('Connected to WebSocket server at ' + serverUrl);
        vscode.window.showInformationMessage('WebSocket connection established.');
    };

    socket.onmessage =  async (event) => {
        console.log('Message from server: ', event.data);
        vscode.window.showInformationMessage('New message: ' + event.data);
    };

    socket.onerror = function(event) {
        console.error('WebSocket error: ', event);
        vscode.window.showErrorMessage('WebSocket error: Check console for more details.');
    };

    socket.onclose = function(event) {
        console.log('Disconnected from WebSocket server', event);
        vscode.window.showWarningMessage('WebSocket connection closed.');
    };

    // Ensure the WebSocket is closed when the extension is deactivated
    context.subscriptions.push(new vscode.Disposable(() => {
        socket.close();
    }));
}

export function deactivate() {
    // Cleanup will be handled by the context.subscriptions
}