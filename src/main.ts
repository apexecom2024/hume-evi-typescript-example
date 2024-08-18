import {
  base64ToBlob,
  checkForAudioTracks,
  createConfig,
  getAudioStream,
  getSupportedMimeType,
  VoiceClient,
} from '@humeai/voice';

function getElementById<T extends HTMLElement>(id: string): T | null {
  const element = document.getElementById(id);
  return element as T | null;
}

(async () => {
  const gif = getElementById<HTMLImageElement>('gif');
  const chat = getElementById<HTMLDivElement>('chat');

  // Auto request microphone permission and start AI
  await requestMicrophonePermission();
  await authenticate();
  await connect();

  gif?.addEventListener('click', () => {
    if (client) {
      if (client.readyState === WebSocket.OPEN) {
        disconnect();
      } else {
        connect();
      }
    }
  });

  /**
   * Request microphone permission
   */
  async function requestMicrophonePermission(): Promise<void> {
    try {
      await getAudioStream();
    } catch (e) {
      console.error('Failed to get microphone permission:', e);
    }
  }

  /**
   * Fetches access token using the API key and client secret specified within your environment variables
   */
  async function authenticate(): Promise<void> {
    const apiKey = import.meta.env.VITE_HUME_API_KEY || '';
    const clientSecret = import.meta.env.VITE_HUME_CLIENT_SECRET || '';

    const authString = `${apiKey}:${clientSecret}`;
    const encoded = btoa(authString);

    try {
      const res = await fetch('https://api.hume.ai/oauth2-cc/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${encoded}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
        }).toString(),
        cache: 'no-cache',
      });
      const data = (await res.json()) as { access_token: string };
      accessToken = String(data['access_token']);
    } catch (e) {
      console.error('Failed to authenticate:', e);
    }
  }

  /**
   * Instantiates interface config and client, sets up Web Socket handlers, and establishes secure Web Socket connection
   */
  async function connect(): Promise<void> {
    const config = createConfig({
      auth: {
        type: 'accessToken',
        value: accessToken,
      },
    });
    client = VoiceClient.create(config);

    client.on('open', async () => {
      console.log('Web socket connection opened');
      await captureAudio();
    });

    client.on('message', async (message) => {
      switch (message.type) {
        case 'user_message':
        case 'assistant_message':
          const { role, content } = message.message;
          appendMessage(role, content);
          break;

        case 'audio_output':
          const audioOutput = message.data;
          const blob = base64ToBlob(audioOutput, mimeType);
          audioQueue.push(blob);
          if (audioQueue.length <= 1) {
            await playAudio();
          }
          break;

        case 'user_interruption':
          stopAudio();
          break;
      }
    });

    client.on('close', () => {
      console.log('Web socket connection closed');
    });

    client.connect();
  }

  /**
   * Stops audio capture and playback, and closes the Web Socket connection
   */
  function disconnect(): void {
    stopAudio();
    recorder?.stop();
    recorder = null;
    audioStream = null;
    client?.disconnect();
    appendMessage('system', 'Conversation ended.');
  }

  /**
   * Captures and records audio stream
   */
  async function captureAudio(): Promise<void> {
    audioStream = await getAudioStream();
    checkForAudioTracks(audioStream);

    recorder = new MediaRecorder(audioStream, { mimeType });

    recorder.ondataavailable = async ({ data }) => {
      if (data.size > 0 && client?.readyState === WebSocket.OPEN) {
        const buffer = await data.arrayBuffer();
        client?.sendAudio(buffer);
      }
    };

    recorder.start(100);
  }

  /**
   * Play the audio within the playback queue
   */
  function playAudio(): void {
    if (audioQueue.length > 0 && !isPlaying) {
      isPlaying = true;
      const audioBlob = audioQueue.shift();

      if (audioBlob) {
        const audioUrl = URL.createObjectURL(audioBlob);
        currentAudio = new Audio(audioUrl);
        currentAudio.play();
        currentAudio.onended = async () => {
          isPlaying = false;
          if (audioQueue.length) playAudio();
        };
      }
    }
  }

  /**
   * Stops audio playback
   */
  function stopAudio(): void {
    currentAudio?.pause();
    currentAudio = null;
    isPlaying = false;
    audioQueue.length = 0;
  }

  /**
   * Adds message to Chat in the webpage's UI
   */
  function appendMessage(role: 'assistant' | 'system' | 'user', content: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const messageEl = document.createElement('p');
    messageEl.innerHTML = `<strong>[${timestamp}] ${role}:</strong> ${content}`;
    chat?.appendChild(messageEl);
  }
})();
