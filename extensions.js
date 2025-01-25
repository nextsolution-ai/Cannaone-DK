export const OpenAIAssistantsV2Extension = {
  name: 'OpenAIAssistantsV2',
  type: 'response',
  match: ({ trace }) =>
    trace.type === 'ext_openai_assistants_v2' ||
    (trace.payload && trace.payload.name === 'ext_openai_assistants_v2'),

  render: async ({ trace, element }) => {
    const { payload } = trace || {};
    const { apiKey, assistantId, threadId, userMessage } = payload || {};

    if (!document.getElementById('thinkingBubbleStyle')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'thinkingBubbleStyle';
      styleEl.innerHTML = `
        .vfrc-message--extension-WaitingAnimation {
          background-color: transparent !important;
          background: none !important;
        }
        .waiting-animation-container {
          font-family: Arial, sans-serif;
          font-size: 14px;
          font-weight: 300;
          color: #fffc;
          display: flex;
          align-items: center;
        }
        .waiting-text {
          display: inline-block;
          margin-left: -20px;
        }
        .waiting-letter {
          display: inline-block;
          animation: shine 1s linear infinite;
        }
        @keyframes shine {
          0%, 100% { color: #fffc; }
          50% { color: #000; }
        }
        .spinner {
          width: 0px;
          height: 0px;
          border: 0px solid #fffc;
          border-top: 0px solid #CF0A2C;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .response-container {
          text-align: left;
          color: #1a1e23;
          font-family: "Open Sans", sans-serif;
          position: relative;
          min-height: 41px;
          min-width: 64px;
          max-width: 100%;
          font-size: 14px;
          line-height: 20px;
          border-radius: 10px;
          width: fit-content;
          white-space: pre-wrap;
        }
      `;
      document.head.appendChild(styleEl);
    }

    const responseContainer = document.createElement('div');
    responseContainer.classList.add('response-container');
    element.appendChild(responseContainer);

    const thinkingBubble = document.createElement('div');
    thinkingBubble.classList.add('vfrc-message--extension-WaitingAnimation');
    const thinkingText = "Thinking...";

    thinkingBubble.innerHTML = `
      <div class="waiting-animation-container">
        <div class="spinner"></div>
        <span class="waiting-text">
          ${thinkingText
            .split('')
            .map((letter, index) =>
              letter === ' '
                ? ' '
                : `<span class="waiting-letter" style="animation-delay: ${
                    index * (1000 / thinkingText.length)
                  }ms">${letter}</span>`
            )
            .join('')}
        </span>
      </div>
    `;
    responseContainer.appendChild(thinkingBubble);

    try {
      let sseResponse;
      if (!threadId || !threadId.match(/^thread_/)) {
        sseResponse = await fetch('https://api.openai.com/v1/threads/runs', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({
            assistant_id: assistantId,
            stream: true,
            thread: {
              messages: [{ role: 'user', content: userMessage }]
            }
          })
        });
      } else {
        await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({ role: 'user', content: userMessage })
        });

        sseResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Beta': 'assistants=v2'
          },
          body: JSON.stringify({ assistant_id: assistantId, stream: true })
        });
      }

      if (!sseResponse.ok) {
        throw new Error(`OpenAI SSE Error: ${sseResponse.status}`);
      }

      const reader = sseResponse.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let done = false;
      let partialAccumulator = '';
      let firstTextArrived = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) {
              continue;
            }

            const dataStr = line.slice('data:'.length).trim();
            if (dataStr === '[DONE]') {
              done = true;
              break;
            }

            let json;
            try {
              json = JSON.parse(dataStr);
            } catch {
              continue;
            }

            if (json.object === 'thread.message.delta' && json.delta?.content) {
              for (const contentItem of json.delta.content) {
                if (contentItem.type === 'text') {
                  partialAccumulator += contentItem.text?.value || '';

                  if (!firstTextArrived && partialAccumulator) {
                    firstTextArrived = true;
                    if (responseContainer.contains(thinkingBubble)) {
                      responseContainer.removeChild(thinkingBubble);
                    }
                  }

                  responseContainer.innerHTML = partialAccumulator
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/\!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2" style="max-width: 100%; display: block; margin: 10px 0;">')
                    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
                    .replace(/^###\s(.*?)(?=\n|$)/gm, '<strong style="display: block; margin-top: 10px;">$1</strong>')
                    .replace(/^\-\s(.*?)(?=\n|$)/gm, '<br>• $1');
                }
              }
            }
          }
        }
      }

      if (!partialAccumulator) {
        if (responseContainer.contains(thinkingBubble)) {
          responseContainer.removeChild(thinkingBubble);
        }
        responseContainer.textContent = '(No response)';
      }

      window.voiceflow?.chat?.interact?.({
        type: 'complete',
        payload: {
          response: partialAccumulator
        }
      });

    } catch (error) {
      if (responseContainer.contains(thinkingBubble)) {
        responseContainer.removeChild(thinkingBubble);
      }
      responseContainer.textContent = `Error: ${error.message}`;
    }
  }
};
