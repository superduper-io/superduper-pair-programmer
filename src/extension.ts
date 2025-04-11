import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import * as os from 'os';
import * as path from 'path';
import { registerSimpleParticipant } from './simple';

function resolvePath(pathStr: string): string {
    if (pathStr.startsWith('~/')) {
        // Replace '~' with the home directory path
        return path.join(os.homedir(), pathStr.slice(2));
    }
    return pathStr;
}

// Reference to the Python child process (server)
let pythonProcess: any = null;

// Create an OutputChannel for Python logs
const pythonOutputChannel = vscode.window.createOutputChannel('Superduper-Pair-Programmer Logs');

// Keep a reference to our Webview panel so we can reuse it
let notificationPanel: vscode.WebviewPanel | undefined;

/**
 * Create or reveal the notification panel in VS Code.
 * Initially loads an empty page. We'll overwrite it when a new message arrives.
 */
function createOrShowNotificationPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
    if (notificationPanel) {
        // If the panel already exists, reveal it
        notificationPanel.reveal(vscode.ViewColumn.Beside);
        return notificationPanel;
    }

    // Otherwise, create a brand new Webview
    notificationPanel = vscode.window.createWebviewPanel(
        'pushNotifications',
        'Superduper Pair Programmer',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // When the user closes the panel, clean up
    notificationPanel.onDidDispose(() => {
        notificationPanel = undefined;
    }, null, context.subscriptions);

    // Show an initially empty page
    notificationPanel.webview.html = getEmptyHtmlContent();

    return notificationPanel;
}

/**
 * Returns a minimal HTML page that is initially empty (no messages).
 */
function getEmptyHtmlContent(): string {
    return /* html */ `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Superduper Pair Programmer</title>
    </head>
    <body>
    </body>
    </html>
    `;
}

/**
 * Given a raw markdown string, return a complete HTML page that loads 'marked'
 * from a CDN and immediately renders the markdown as HTML in the body.
 *
 * Note: If you prefer not to load from a CDN, bundle 'marked' locally instead.
 */
function getMarkdownHtmlContent(markdown: string): string {
    const escaped = JSON.stringify(markdown); // escape for safe inline JS
    return /* html */ `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Superduper Pair Programmer</title>
        <!-- Marked library (CDN). In production, consider bundling locally. -->
        <script src="https://unpkg.com/marked@5.0.0/marked.min.js"></script>
    </head>
    <body>
        <script>
            // Parse and display the markdown
            const rawMarkdown = ${escaped};
            const htmlContent = marked.parse(rawMarkdown);
            document.write(htmlContent);
        </script>
    </body>
    </html>
    `;
}

/**
 * Main logic to:
 *  1. Subscribe to file-save events.
 *  2. Spawn the Python server.
 *  3. Connect via WebSocket.
 *  4. Display new messages in a webview (overwriting it each time).
 */
function startExtensionLogic(context: vscode.ExtensionContext) {

    console.log("Starting the extension logic...");

    registerSimpleParticipant(context);

    // Keep your existing onDidSaveTextDocument logic
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
        vscode.window.showInformationMessage('Document saved: ' + document.fileName);
    }));

    // Launch the Python server
    const pythonPath = vscode.workspace.getConfiguration('superduper-pair-programmer')
        .get('pythonPath', '/Users/dodo/.pyenv/versions/3.10.13/envs/superduper-3.10/bin/python');
    const configPath = vscode.workspace.getConfiguration('superduper-pair-programmer')
        .get('serverPath', '~/superduper-io/superduper/templates/copilot/server.py');
    const serverPath = resolvePath(configPath);

    const cwdPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwdPath) {
        vscode.window.showErrorMessage('No workspace folder found. Please open a folder in VS Code.');
        return;
    }

    console.log(`CWD: ${cwdPath}`);

    // Spawn the python process in the workspace root
    const options = { cwd: cwdPath };
    console.log("Activating the python backend...");
    console.log(pythonPath);
    console.log(serverPath);

    pythonProcess = spawn(pythonPath, [serverPath], options);

    pythonProcess.stdout.on('data', (data: Buffer | string) => {
        const text = data.toString().trim();
        pythonOutputChannel.appendLine(`[PYTHON/STDOUT] ${text}`);
    });

    pythonProcess.stderr.on('data', (data: Buffer | string) => {
        const text = data.toString().trim();
        pythonOutputChannel.appendLine(`[PYTHON/STDERR] ${text}`);

        // If we see the server is up, connect to it via WebSocket
        if (text.includes('Uvicorn running on http://127.0.0.1:8000')) {
            const serverUrl = 'ws://127.0.0.1:8000/ws';
            const socket = new WebSocket(serverUrl);

            socket.onopen = () => {
                pythonOutputChannel.appendLine(`Connected to WebSocket server at ${serverUrl}`);

                // Show the webview (empty initially)
                const panel = createOrShowNotificationPanel(context);

                // Overwrite it with a "connected" message
                panel.webview.html = getMarkdownHtmlContent(
                    `**WebSocket** connected at \`${serverUrl}\``
                );
            };

            socket.onmessage = async (event) => {
                pythonOutputChannel.appendLine(`Message from server: ${event.data}`);

                // Overwrite the entire webview content with the new message

                const data = JSON.parse(event.data.toString());
                const body = `**${data.filename}**` + '\n\n' + data.comment;
                const panel = createOrShowNotificationPanel(context);
                panel.webview.html = getMarkdownHtmlContent(body);
            };

            socket.onerror = (event) => {
                pythonOutputChannel.appendLine(`WebSocket error: ${event}`);
                vscode.window.showErrorMessage('WebSocket error: Check Python Logs for more details.');
            };

            socket.onclose = (event) => {
                pythonOutputChannel.appendLine(`Disconnected from WebSocket server: ${event}`);
                vscode.window.showWarningMessage('WebSocket connection closed.');
            };

            // Cleanly close the socket if the extension is deactivated
            context.subscriptions.push(new vscode.Disposable(() => socket.close()));
        }
    });

    pythonProcess.on('close', (code: number) => {
        pythonOutputChannel.appendLine(`Python server process exited with code ${code}`);
    });
}

export function activate(context: vscode.ExtensionContext) {
    console.log("Activating the extension...");

    // Add a command to start it manually
    const startCommand = vscode.commands.registerCommand('superduper-pair-programmer.start', () => {
        console.log("Manually starting the extension...");
        startExtensionLogic(context);
    });

    context.subscriptions.push(startCommand);
}

export function deactivate() {
    if (pythonProcess !== null) {
        console.log("Deactivating the extension and killing the Python process...");
        pythonProcess.kill();
    }
}

