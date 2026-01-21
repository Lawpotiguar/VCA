/**
 * INTEGRAÇÕES DE NOVAS FUNCIONALIDADES
 * Extensões ao app.js principal
 */

// Inicializar todos os módulos quando a página carregar
window.addEventListener('load', async () => {
  console.log('🚀 Inicializando módulos avançados...');

  // 1. Inicializar criptografia E2EE
  await window.encryptionManager.init();

  // 2. Inicializar monitor de qualidade de conexão
  if (window.socket && window.ConnectionQualityMonitor) {
    window.qualityMonitor = new window.ConnectionQualityMonitor(window.socket);
    window.qualityMonitor.start();
  }

  // 3. Inicializar gerenciador de status
  window.statusManager.init();

  console.log('✅ Todos os módulos inicializados');
});

// ==================== HANDLERS DE CHAT MELHORADO ====================

// Função para processar menções e emojis
function parseMessageContent(text) {
  let processed = text;

  // Converter emoji codes para emojis
  const emojiMap = {
    ':)': '😊',
    ':(': '😞',
    ':D': '😄',
    ';)': '😉',
    ':P': '😜',
    ':/': '😕',
    '❤️': '❤️',
    '🎉': '🎉',
    '🎵': '🎵',
    '🔥': '🔥',
    '💯': '💯',
    '👍': '👍',
    '👎': '👎'
  };

  for (const [code, emoji] of Object.entries(emojiMap)) {
    processed = processed.replace(new RegExp(code, 'g'), emoji);
  }

  return processed;
}

// Suportar envio de mídia/links
function handleMediaUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,video/*';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Verificar rate limit
    if (!window.rateLimiter.canProceed(window.myUser?.id, 'media')) {
      showNotification('⏱️ Aguarde antes de enviar outra mídia', 'warning');
      return;
    }

    // Converter arquivo para base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target.result;
      const fileSize = (file.size / 1024 / 1024).toFixed(2); // MB

      if (fileSize > 10) {
        showNotification('❌ Arquivo muito grande (máx 10MB)', 'error');
        return;
      }

      // Criar mensagem com mídia
      const mediaMessage = {
        type: 'media',
        content: base64,
        fileName: file.name,
        fileType: file.type,
        fileSize: fileSize
      };

      // Criptografar se E2EE ativo
      if (window.encryptionManager.isEncryptionEnabled()) {
        const encrypted = window.encryptionManager.encryptMessage(
          JSON.stringify(mediaMessage),
          window.currentRoom?.encryptionKey
        );
        mediaMessage.encrypted = encrypted;
      }

      socket.emit('chat-message', mediaMessage);
      
      // Registrar na dashboard
      window.stats?.recordMessageSent(file.size);

      showNotification(`📎 Mídia enviada: ${file.name}`, 'success');
    };

    reader.readAsDataURL(file);
  };

  input.click();
}

// Suportar links com preview
function parseLink(url) {
  try {
    new URL(url);
    return {
      isLink: true,
      url: url,
      domain: new URL(url).hostname
    };
  } catch {
    return { isLink: false };
  }
}

// ==================== ATUALIZAR HANDLERS DE MENSAGEM ====================

// Override do handler de chat original
const originalChatHandler = document.getElementById('chat-form')?.onsubmit;
if (document.getElementById('chat-form')) {
  document.getElementById('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const input = document.getElementById('chat-input');
    const message = input.value.trim();

    if (!message) return;

    // Verificar rate limit
    if (!window.rateLimiter.canProceed(window.myUser?.id, 'message')) {
      showNotification('⏱️ Você está enviando mensagens muito rápido', 'warning');
      return;
    }

    // Parsear conteúdo (emojis, links)
    const parsed = parseMessageContent(message);
    const linkData = parseLink(message);

    // Criptografar mensagem
    let finalMessage = parsed;
    let encryptionData = null;

    if (window.encryptionManager.isEncryptionEnabled()) {
      encryptionData = window.encryptionManager.encryptMessage(
        parsed,
        window.currentRoom?.encryptionKey
      );
      finalMessage = encryptionData;
    }

    // Enviar
    socket.emit('chat-message', {
      content: finalMessage,
      isEncrypted: encryptionData?.algorithm !== 'plain',
      hasLink: linkData.isLink,
      linkUrl: linkData.url || null
    });

    // Registrar
    window.stats?.recordMessageSent(message.length);

    input.value = '';
  });
}

// ==================== QUALIDADE DE CONEXÃO ====================

// Integrar com evento de update de qualidade
socket.on('connection-quality-update', (qualityData) => {
  if (window.qualityMonitor) {
    window.qualityMonitor.stats = qualityData;
    window.qualityMonitor.updateQualityIndicator();
  }
});

// Ping/Pong para latência
socket.on('ping', (callback) => {
  if (callback) callback();
});

// ==================== STATISTICS DASHBOARD ====================

// Criar instância de dashboard
window.stats = new window.StatisticsDashboard();

// Botão de estatísticas
document.getElementById('stats-btn')?.addEventListener('click', () => {
  const modal = document.getElementById('stats-modal');
  if (modal) {
    modal.classList.remove('hidden');
    updateStatsDisplay();
  }
});

function updateStatsDisplay() {
  const stats = window.stats?.getStats();
  if (!stats) return;

  document.getElementById('stat-current-users').textContent = stats.peersConnected;
  document.getElementById('stat-total-rooms').textContent = stats.roomsJoined;
  document.getElementById('stat-uptime').textContent = `${Math.floor(stats.uptime / 60)}min`;
  document.getElementById('stat-total-messages').textContent = stats.messagesReceived;
}

// Fechar modal de estatísticas
document.getElementById('close-stats')?.addEventListener('click', () => {
  document.getElementById('stats-modal')?.classList.add('hidden');
});

document.getElementById('refresh-stats')?.addEventListener('click', () => {
  updateStatsDisplay();
  showNotification('📊 Estatísticas atualizadas', 'success');
});

// ==================== CONFIGURAÇÕES DE ÁUDIO AVANÇADAS ====================

// Botão de configurações
document.getElementById('settings-btn')?.addEventListener('click', async () => {
  if (window.audioSettings) {
    window.audioSettings.showPanel();
  } else {
    showNotification('⚙️ Carregando configurações...', 'info');
  }
});

// Botão de cancelamento de ruído na sala
document.getElementById('noise-cancel-btn')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  const isActive = btn.classList.toggle('active');
  
  if (window.audioSettings) {
    window.audioSettings.toggleNoiseSuppression(isActive);
    showNotification(
      isActive ? '🔇 Supressão de ruído ativada' : '🔇 Supressão de ruído desativada',
      'info'
    );
  }
});

// ==================== STATUS PERSONALIZADOS ====================

// Integrar mudança de status com Socket.IO
socket.on('user-status-change', (data) => {
  const userId = data.userId;
  const status = data.status;

  if (window.statusManager) {
    window.statusManager.setUserStatus(userId, status, data.customText);
  }

  // Atualizar UI do usuário na lista
  const userElement = document.querySelector(`[data-user-id="${userId}"]`);
  if (userElement) {
    const statusDisplay = window.statusManager.getStatusDisplay(status);
    const statusEl = userElement.querySelector('.user-status');
    if (statusEl) {
      statusEl.textContent = statusDisplay.icon;
      statusEl.title = statusDisplay.label;
    }
  }
});

// ==================== CONEXÃO WEBRTC COM ESTATÍSTICAS ====================

// Registrar peers conectados
const originalAddPeer = window.addPeer;
if (typeof originalAddPeer === 'function') {
  window.addPeer = async function(userId, stream) {
    await originalAddPeer(userId, stream);
    window.stats?.recordPeerConnected(userId);
  };
}

// Registrar peers desconectados
const originalRemovePeer = window.removePeer;
if (typeof originalRemovePeer === 'function') {
  window.removePeer = function(userId) {
    originalRemovePeer(userId);
    window.stats?.recordPeerDisconnected(userId);
  };
}



// ==================== INICIALIZAÇÃO FINAL ====================

console.log('✅ Extensões de funcionalidades carregadas com sucesso');
