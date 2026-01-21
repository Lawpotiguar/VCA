/**
 * ADVANCED AUDIO PROCESSING
 * Compressão Opus, filtros de ruído, processamento de áudio
 */

class AdvancedAudioProcessor {
  constructor(audioContext) {
    this.audioContext = audioContext;
    this.filters = {
      noiseSuppression: false,
      echoCancellation: true,
      autoGainControl: true,
      highPassFilter: false,
      compressor: false
    };
    this.nodes = new Map();
    this.initialized = false;
  }

  async init(sourceNode) {
    try {
      console.log('🔧 Inicializando processador avançado de áudio...');
      
      // Criar nós de processamento
      
      // 1. Compressor (simula Opus)
      const compressor = this.audioContext.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      this.nodes.set('compressor', compressor);
      
      // 2. Filtro high-pass (remove ruído de frequência muito baixa)
      const highPassFilter = this.audioContext.createBiquadFilter();
      highPassFilter.type = 'highpass';
      highPassFilter.frequency.value = 80; // Remove frequências abaixo de 80Hz
      this.nodes.set('highPassFilter', highPassFilter);
      
      // 3. Analisador para detecção de ruído
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      this.nodes.set('analyser', analyser);
      
      // 4. Ganho (volume)
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 1;
      this.nodes.set('gainNode', gainNode);
      
      // Conectar nós: sourceNode -> compressor -> highPassFilter -> gainNode -> analyser
      sourceNode.connect(compressor);
      compressor.connect(highPassFilter);
      highPassFilter.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(this.audioContext.destination);
      
      this.initialized = true;
      console.log('✅ Processador de áudio inicializado');
      return true;
    } catch (error) {
      console.error('❌ Erro ao inicializar processador:', error);
      return false;
    }
  }

  enableNoiseSuppression(enable) {
    this.filters.noiseSuppression = enable;
    if (enable) {
      const highPassFilter = this.nodes.get('highPassFilter');
      if (highPassFilter) {
        highPassFilter.frequency.value = 100;
      }
      console.log('🎤 Supressão de ruído: ATIVADA');
    } else {
      const highPassFilter = this.nodes.get('highPassFilter');
      if (highPassFilter) {
        highPassFilter.frequency.value = 20; // Volta ao padrão
      }
      console.log('🎤 Supressão de ruído: DESATIVADA');
    }
  }

  enableCompression(enable) {
    this.filters.compressor = enable;
    const compressor = this.nodes.get('compressor');
    if (compressor) {
      compressor.threshold.value = enable ? -50 : -100;
      console.log(`📊 Compressão: ${enable ? 'ATIVADA' : 'DESATIVADA'}`);
    }
  }

  setVolume(level) {
    const gainNode = this.nodes.get('gainNode');
    if (gainNode) {
      gainNode.gain.value = Math.max(0, Math.min(2, level)); // 0-2x
    }
  }

  getAudioLevel() {
    const analyser = this.nodes.get('analyser');
    if (!analyser) return 0;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    return Math.min(100, average);
  }

  getFrequencyData() {
    const analyser = this.nodes.get('analyser');
    if (!analyser) return new Uint8Array(0);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  getFiltersStatus() {
    return this.filters;
  }
}

window.AdvancedAudioProcessor = AdvancedAudioProcessor;
