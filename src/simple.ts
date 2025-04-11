import * as vscode from 'vscode';

const CAT_PARTICIPANT_ID = 'chat-sample.cat';

interface ICatChatResult extends vscode.ChatResult {
    metadata: {
        command: string;
    }
}

interface AskSuperDuperResponse {
    answer: string;
}

export function registerSimpleParticipant(context: vscode.ExtensionContext) {

    // Define a Cat chat handler.
    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<ICatChatResult> => {
        // To talk to an LLM in your subcommand handler implementation, your
        // extension can use VS Code's `requestChatAccess` API to access the Copilot API.
        // The GitHub Copilot Chat extension implements this provider.
        stream.progress('Picking the right topic to teach...');
        const topic = 'testing 123: ';
        console.log(request)
        console.log(context)
        const activeEditor = vscode.window.activeTextEditor;
        const activeFilename = activeEditor?.document?.fileName;

        const response = await fetch(
            'http://localhost:8000/ask_superduper',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({question: request.prompt, filename: activeFilename}),
            }
        );
        const data = await response.json() as AskSuperDuperResponse;
        console.log(data);
        try {
            stream.markdown(data.answer);
        } catch (err) {
            console.error('Error in superduper handler: ', err);
        }
        return { metadata: { command: 'randomTeach' } };
    };

    // Chat participants appear as top-level options in the chat input
    // when you type `@`, and can contribute sub-commands in the chat input
    // that appear when you type `/`.
    const cat = vscode.chat.createChatParticipant(CAT_PARTICIPANT_ID, handler);
    cat.iconPath = vscode.Uri.joinPath(context.extensionUri, 'cat.jpeg');
}