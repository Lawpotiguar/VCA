class WebRTCManager {
  constructor(socket, audioManager) {
    this.socket = socket;
    this.audioManager = audioManager;
    this.peerConnections = new Map();
    this.remoteStreams = new Map();
    
    this.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };

    this.setupSocketListeners();
    this.createAudioContainer();
  }

  createAudioContainer() {
    if (!document.getElementById('remote-audios')) {
      const container = document.createElement('div');
      container.id = 'remote-audios';
      container.style.display = 'none';
      document.body.appendChild(container);
    }
  }

  setupSocketListeners() {
    this.socket.on('webrtc-offer', async (data) => {
      console.log('📥 Recebido offer de:', data.senderName || data.senderId);
      await this.handleOffer(data);
    });

    this.socket.on('webrtc-answer', async (data) => {
      console.log('📥 Recebido answer de:', data.senderId);
      await this.handleAnswer(data);
    });

    this.socket.on('webrtc-ice-candidate', async (data) => {
      await this.handleIceCandidate(data);
    });

    this.socket.on('user-left', (data) => {
      this.closePeerConnection(data.userId);
    });
  }

  async createPeerConnection(peerId) {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId);
    }

    console.log('🔗 Criando conexão P2P com:', peerId);
    
    const pc = new RTCPeerConnection(this.config);
    this.peerConnections.set(peerId, pc);

    if (this.audioManager.localStream) {
      this.audioManager.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.audioManager.localStream);
      });
    }

    pc.ontrack = (event) => {
      console.log('🎵 Track remoto recebido de:', peerId);
      if (event.streams && event.streams[0]) {
        this.handleRemoteStream(peerId, event.streams[0]);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('webrtc-ice-candidate', {
          targetId: peerId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`📊 Estado conexão [${peerId}]:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.closePeerConnection(peerId);
      }
    };

    return pc;
  }

  async initiateConnection(peerId) {
    console.log('🚀 Iniciando conexão com:', peerId);
    
    try {
      const pc = await this.createPeerConnection(peerId);

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });
      
      await pc.setLocalDescription(offer);

      this.socket.emit('webrtc-offer', {
        targetId: peerId,
        offer: offer
      });
    } catch (error) {
      console.error('❌ Erro ao iniciar conexão:', error);
    }
  }

  async handleOffer(data) {
    const { senderId, offer } = data;
    
    try {
      const pc = await this.createPeerConnection(senderId);

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit('webrtc-answer', {
        targetId: senderId,
        answer: answer
      });
    } catch (error) {
      console.error('❌ Erro ao processar offer:', error);
    }
  }

  async handleAnswer(data) {
    const { senderId, answer } = data;
    const pc = this.peerConnections.get(senderId);
    
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error('❌ Erro ao processar answer:', error);
      }
    }
  }

  async handleIceCandidate(data) {
    const { senderId, candidate } = data;
    const pc = this.peerConnections.get(senderId);
    
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('❌ Erro ao adicionar ICE candidate:', error);
      }
    }
  }

  handleRemoteStream(peerId, stream) {
    console.log('🔊 Configurando áudio remoto para:', peerId);
    this.remoteStreams.set(peerId, stream);

    const existingAudio = document.getElementById(`audio-${peerId}`);
    if (existingAudio) {
      existingAudio.remove();
    }

    const audio = document.createElement('audio');
    audio.id = `audio-${peerId}`;
    audio.className = 'remote-audio';
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1.0;
    
    const container = document.getElementById('remote-audios');
    container.appendChild(audio);

    audio.srcObject = stream;
    
    audio.play()
      .then(() => {
        console.log('✅ Áudio remoto reproduzindo');
      })
      .catch(error => {
        console.warn('⚠️ Autoplay bloqueado:', error);
        this.showPlayPrompt();
      });

    if (this.audioManager.outputDeviceId && audio.setSinkId) {
      audio.setSinkId(this.audioManager.outputDeviceId).catch(console.warn);
    }
  }

  showPlayPrompt() {
    if (document.getElementById('audio-play-prompt')) return;

    const prompt = document.createElement('div');
    prompt.id = 'audio-play-prompt';
    prompt.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #e94560;
      color: white;
      padding: 15px 25px;
      border-radius: 8px;
      cursor: pointer;
      z-index: 9999;
      font-weight: bold;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    `;
    prompt.textContent = '🔊 Clique para ativar o áudio';
    
    prompt.onclick = () => {
      document.querySelectorAll('.remote-audio').forEach(a => {
        a.play().catch(console.warn);
      });
      prompt.remove();
    };
    
    document.body.appendChild(prompt);
  }

  closePeerConnection(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }

    const audio = document.getElementById(`audio-${peerId}`);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }

    this.remoteStreams.delete(peerId);
  }

  closeAllConnections() {
    this.peerConnections.forEach((pc, peerId) => {
      this.closePeerConnection(peerId);
    });
    
    const prompt = document.getElementById('audio-play-prompt');
    if (prompt) prompt.remove();
  }

  async connectToUsers(users) {
    console.log('👥 Conectando a', users.length, 'usuário(s)');
    
    for (const user of users) {
      if (user.id !== this.socket.id) {
        await new Promise(resolve => setTimeout(resolve, 300));
        await this.initiateConnection(user.id);
      }
    }
  }
}

this.config = {
  iceServers: [
    // Forçar TURN relay (esconde IP real)
    {
      urls: 'turn:locahost:3478',
      username: 'anonymous',
      credential: '12345678'
    }
  ],
  iceTransportPolicy: 'relay' // IMPORTANTE: Força usar TURN, esconde IP
};

window.WebRTCManager = WebRTCManager;