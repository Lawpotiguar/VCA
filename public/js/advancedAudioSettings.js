/**
 * ADVANCED AUDIO SETTINGS
 * Configurações avançadas de dispositivos de áudio
 * Extensão do AudioManager existente
 */

class AdvancedAudioSettings {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this.settings = {
      inputDevice: 'default',
      outputDevice: 'default',
      micVolume: 1,
      outputVolume: 1,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      highPassFilter: true,
      compression: true,
      pushToTalk: false,
      voiceActivity: true
    };
    this.initialized = false;
  }

  async init() {
    try {
      console.log('⚙️ Inicializando configurações avançadas de áudio...');
      await this.loadSettings();
      this.createSettingsPanel();
      this.initialized = true;
      console.log('✅ Configurações avançadas inicializadas');
      return true;
    } catch (error) {
      console.error('❌ Erro ao inicializar configurações:', error);
      return false;
    }
  }

  async loadSettings() {
    // Carregar de localStorage
    const saved = localStorage.getItem('audioSettings');
    if (saved) {
      this.settings = { ...this.settings, ...JSON.parse(saved) };
    }

    // Aplicar configurações
    await this.applySettings();
  }

  async applySettings() {
    // Trocar dispositivo de entrada
    if (this.settings.inputDevice !== 'default') {
      await this.audioManager.setInputDevice(this.settings.inputDevice);
    }

    // Trocar dispositivo de saída
    if (this.settings.outputDevice !== 'default') {
      await this.audioManager.setOutputDevice(this.settings.outputDevice);
    }

    // Aplicar volumes
    this.audioManager.micVolume = this.settings.micVolume;
    this.audioManager.outputVolume = this.settings.outputVolume;

    // Push to talk
    this.audioManager.setPushToTalk(this.settings.pushToTalk);
  }

  async changeInputDevice(deviceId) {
    try {
      this.settings.inputDevice = deviceId;
      await this.audioManager.setInputDevice(deviceId);
      this.saveSettings();
      console.log(`✅ Dispositivo de entrada mudado para ${deviceId}`);
      return true;
    } catch (error) {
      console.error('❌ Erro ao mudar dispositivo de entrada:', error);
      return false;
    }
  }

  async changeOutputDevice(deviceId) {
    try {
      this.settings.outputDevice = deviceId;
      await this.audioManager.setOutputDevice(deviceId);
      this.saveSettings();
      console.log(`✅ Dispositivo de saída mudado para ${deviceId}`);
      return true;
    } catch (error) {
      console.error('❌ Erro ao mudar dispositivo de saída:', error);
      return false;
    }
  }

  setMicVolume(level) {
    this.settings.micVolume = Math.max(0, Math.min(2, level));
    this.audioManager.micVolume = this.settings.micVolume;
    this.saveSettings();
  }

  setOutputVolume(level) {
    this.settings.outputVolume = Math.max(0, Math.min(2, level));
    this.audioManager.outputVolume = this.settings.outputVolume;
    
    // Aplicar volume a todos os áudios
    document.querySelectorAll('audio.remote-audio').forEach(audio => {
      audio.volume = this.settings.outputVolume;
    });
    
    this.saveSettings();
  }

  toggleNoiseSuppression(enabled) {
    this.settings.noiseSuppression = enabled;
    this.saveSettings();
    return enabled ? '✅ Supressão de ruído ativada' : '❌ Supressão de ruído desativada';
  }

  toggleEchoCancellation(enabled) {
    this.settings.echoCancellation = enabled;
    this.saveSettings();
    return enabled ? '✅ Cancelamento de echo ativado' : '❌ Cancelamento de echo desativado';
  }

  toggleAutoGainControl(enabled) {
    this.settings.autoGainControl = enabled;
    this.saveSettings();
    return enabled ? '✅ Controle de ganho automático ativado' : '❌ Controle de ganho automático desativado';
  }

  toggleHighPassFilter(enabled) {
    this.settings.highPassFilter = enabled;
    this.saveSettings();
    return enabled ? '✅ Filtro high-pass ativado' : '❌ Filtro high-pass desativado';
  }

  toggleCompression(enabled) {
    this.settings.compression = enabled;
    this.saveSettings();
    return enabled ? '✅ Compressão ativada' : '❌ Compressão desativada';
  }

  togglePushToTalk(enabled) {
    this.settings.pushToTalk = enabled;
    this.audioManager.setPushToTalk(enabled);
    this.saveSettings();
    return enabled ? '✅ Push-to-talk ativado (Pressione ESPAÇO)' : '❌ Push-to-talk desativado';
  }

  toggleVoiceActivity(enabled) {
    this.settings.voiceActivity = enabled;
    this.saveSettings();
    return enabled ? '✅ Detecção de voz ativada' : '❌ Detecção de voz desativada';
  }

  saveSettings() {
    localStorage.setItem('audioSettings', JSON.stringify(this.settings));
  }

  createSettingsPanel() {
    const panel = document.createElement('div');
    panel.id = 'audio-settings-panel';
    panel.className = 'audio-settings-panel hidden';
    
    panel.innerHTML = `
      <div class="settings-content">
        <div class="settings-header">
          <h3>🎤 Configurações de Áudio</h3>
          <button class="close-btn" onclick="document.getElementById('audio-settings-panel').classList.add('hidden')">✕</button>
        </div>

        <div class="settings-body">
          <!-- Dispositivos de Entrada -->
          <div class="settings-group">
            <label>Microfone:</label>
            <select id="input-device-select" onchange="window.audioSettings?.changeInputDevice(this.value)">
              <option value="default">Padrão</option>
            </select>
            <small id="input-device-status">Nenhum dispositivo</small>
          </div>

          <!-- Dispositivos de Saída -->
          <div class="settings-group">
            <label>Alto-falante:</label>
            <select id="output-device-select" onchange="window.audioSettings?.changeOutputDevice(this.value)">
              <option value="default">Padrão</option>
            </select>
            <small id="output-device-status">Nenhum dispositivo</small>
          </div>

          <!-- Volume do Microfone -->
          <div class="settings-group">
            <label>Volume do Microfone: <span id="mic-volume-display">100%</span></label>
            <input 
              type="range" 
              id="mic-volume-slider" 
              min="0" 
              max="200" 
              value="100"
              onchange="window.audioSettings?.setMicVolume(this.value / 100)"
            >
          </div>

          <!-- Volume de Saída -->
          <div class="settings-group">
            <label>Volume de Saída: <span id="output-volume-display">100%</span></label>
            <input 
              type="range" 
              id="output-volume-slider" 
              min="0" 
              max="200" 
              value="100"
              onchange="window.audioSettings?.setOutputVolume(this.value / 100)"
            >
          </div>

          <!-- Filtros e Processamento -->
          <div class="settings-group">
            <h4>Processamento de Áudio</h4>
            
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="noise-suppression-check"
                checked
                onchange="window.audioSettings?.toggleNoiseSuppression(this.checked)"
              >
              Supressão de Ruído
            </label>

            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="echo-cancellation-check"
                checked
                onchange="window.audioSettings?.toggleEchoCancellation(this.checked)"
              >
              Cancelamento de Echo
            </label>

            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="auto-gain-check"
                checked
                onchange="window.audioSettings?.toggleAutoGainControl(this.checked)"
              >
              Controle de Ganho Automático
            </label>

            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="high-pass-filter-check"
                checked
                onchange="window.audioSettings?.toggleHighPassFilter(this.checked)"
              >
              Filtro High-Pass
            </label>

            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="compression-check"
                checked
                onchange="window.audioSettings?.toggleCompression(this.checked)"
              >
              Compressão (Simula Opus)
            </label>
          </div>

          <!-- Modos Especiais -->
          <div class="settings-group">
            <h4>Modos Especiais</h4>
            
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="push-to-talk-check"
                onchange="window.audioSettings?.togglePushToTalk(this.checked)"
              >
              Push-to-Talk (ESPAÇO)
            </label>

            <label class="checkbox-label">
              <input 
                type="checkbox" 
                id="voice-activity-check"
                checked
                onchange="window.audioSettings?.toggleVoiceActivity(this.checked)"
              >
              Detecção de Voz
            </label>
          </div>

          <!-- Teste de Áudio -->
          <div class="settings-group">
            <button id="test-audio-btn" class="btn-secondary" onclick="window.audioSettings?.testAudio()">
              🔊 Testar Áudio
            </button>
          </div>
        </div>

        <div class="settings-footer">
          <small>As configurações são salvas automaticamente</small>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    this.updateDeviceList();
  }

  async updateDeviceList() {
    const { input, output } = await this.audioManager.loadDevices();

    // Atualizar input devices
    const inputSelect = document.getElementById('input-device-select');
    if (inputSelect) {
      input.forEach(device => {
        if (device.deviceId && device.deviceId !== 'default') {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Microfone ${device.deviceId.slice(0, 5)}`;
          inputSelect.appendChild(option);
        }
      });
      if (input.length > 0) {
        document.getElementById('input-device-status').textContent = `${input.length} dispositivo(s) encontrado(s)`;
      }
    }

    // Atualizar output devices
    const outputSelect = document.getElementById('output-device-select');
    if (outputSelect) {
      output.forEach(device => {
        if (device.deviceId && device.deviceId !== 'default') {
          const option = document.createElement('option');
          option.value = device.deviceId;
          option.textContent = device.label || `Alto-falante ${device.deviceId.slice(0, 5)}`;
          outputSelect.appendChild(option);
        }
      });
      if (output.length > 0) {
        document.getElementById('output-device-status').textContent = `${output.length} dispositivo(s) encontrado(s)`;
      }
    }
  }

  testAudio() {
    const button = document.getElementById('test-audio-btn');
    const originalText = button.textContent;
    
    button.textContent = '▶️ Tocando som de teste...';
    button.disabled = true;

    // Criar tom de teste
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.frequency.value = 440; // A4 (Lá)
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 1);

    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1000);
  }

  getSettings() {
    return this.settings;
  }

  showPanel() {
    document.getElementById('audio-settings-panel')?.classList.remove('hidden');
  }

  hidePanel() {
    document.getElementById('audio-settings-panel')?.classList.add('hidden');
  }
}

// Criar instância global após AudioManager estar disponível
window.addEventListener('load', async () => {
  if (window.audioManager) {
    window.audioSettings = new AdvancedAudioSettings(window.audioManager);
    await window.audioSettings.init();
  }
});
