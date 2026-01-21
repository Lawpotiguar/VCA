class AudioManager {
  constructor() {
    this.localStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.inputDeviceId = null;
    this.outputDeviceId = null;
    this.micVolume = 1;
    this.outputVolume = 1;
    this.pushToTalk = false;
    this.isPushToTalkActive = false;
    this.inputDevices = [];
    this.outputDevices = [];
  }

  async init() {
    try {
      console.log('🎤 Solicitando acesso ao microfone...');
      await this.getLocalStream();
      this.setupAudioContext();
      await this.loadDevices();
      this.setupPushToTalk();
      console.log('✅ Áudio inicializado com sucesso!');
      return true;
    } catch (error) {
      console.error('❌ Erro ao inicializar áudio:', error);
      throw error;
    }
  }

  async getLocalStream(deviceId = null) {
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId && { deviceId: { exact: deviceId } })
      },
      video: false
    };

    try {
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
      }
      
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Stream de áudio obtido');
      return this.localStream;
    } catch (error) {
      console.error('❌ Erro ao acessar microfone:', error.name, error.message);
      throw error;
    }
  }

  setupAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;

      if (this.localStream) {
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        source.connect(this.analyser);
      }
    } catch (error) {
      console.warn('⚠️ Erro ao criar AudioContext:', error);
    }
  }

  getAudioLevel() {
    if (!this.analyser) return 0;

    try {
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);

      const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
      return Math.min(100, average * 1.5);
    } catch (error) {
      return 0;
    }
  }

  async loadDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      this.inputDevices = devices.filter(d => d.kind === 'audioinput');
      this.outputDevices = devices.filter(d => d.kind === 'audiooutput');
      
      console.log('📱 Dispositivos encontrados:', {
        input: this.inputDevices.length,
        output: this.outputDevices.length
      });
      
      return { input: this.inputDevices, output: this.outputDevices };
    } catch (error) {
      console.warn('⚠️ Erro ao listar dispositivos:', error);
      return { input: [], output: [] };
    }
  }

  async setInputDevice(deviceId) {
    this.inputDeviceId = deviceId;
    await this.getLocalStream(deviceId);
    this.setupAudioContext();
  }

  async setOutputDevice(deviceId) {
    this.outputDeviceId = deviceId;
    const audioElements = document.querySelectorAll('audio');
    
    for (const audio of audioElements) {
      if (audio.setSinkId) {
        try {
          await audio.setSinkId(deviceId);
        } catch (error) {
          console.warn('⚠️ Erro ao mudar dispositivo de saída:', error);
        }
      }
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });
    }
  }

  setDeafened(deafened) {
    this.isDeafened = deafened;
    const audioElements = document.querySelectorAll('audio.remote-audio');
    audioElements.forEach(audio => {
      audio.muted = deafened;
    });
  }

  setupPushToTalk() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.pushToTalk && !this.isPushToTalkActive) {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          this.isPushToTalkActive = true;
          this.setMuted(false);
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.pushToTalk) {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          this.isPushToTalkActive = false;
          this.setMuted(true);
        }
      }
    });
  }

  setPushToTalk(enabled) {
    this.pushToTalk = enabled;
    if (enabled) {
      this.setMuted(true);
    }
  }

  isSpeaking() {
    return this.getAudioLevel() > 20;
  }
}

window.audioManager = new AudioManager();