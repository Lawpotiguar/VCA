// public/js/ui.js
class UIManager {
  constructor() {
    this.currentScreen = 'login';
    this.modals = {};
    this.init();
  }

  init() {
    // Fechar modais
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modalId = e.target.dataset.modal;
        if (modalId) {
          this.closeModal(modalId);
        }
      });
    });

    // Fechar modal clicando fora
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal(modal.id);
        }
      });
    });
  }

  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });
    document.getElementById(`${screenId}-screen`).classList.add('active');
    this.currentScreen = screenId;
  }

  openModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
  }

  showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <span>${this.getNotificationIcon(type)}</span>
      <span>${message}</span>
    `;
    container.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 4000);
  }

  getNotificationIcon(type) {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'info': return 'ℹ️';
      default: return '📢';
    }
  }

  updateRoomsList(rooms) {
    const container = document.getElementById('rooms-list');
    container.innerHTML = rooms.map(room => `
      <div class="room-item" data-room-id="${room.id}" data-has-password="${room.hasPassword}">
        <div class="room-item-info">
          <span class="room-item-name">${room.name}</span>
        </div>
        <div class="room-item-meta">
          ${room.hasPassword ? '<span class="room-item-lock">🔒</span>' : ''}
          <span>${room.userCount}/${room.maxUsers}</span>
        </div>
      </div>
    `).join('');
  }

  updateUsersList(users, currentUserId) {
    const container = document.getElementById('room-users');
    container.innerHTML = users.map(user => `
      <div class="user-item" data-user-id="${user.id}" id="user-${user.id}">
        <div class="user-item-avatar">${user.username.charAt(0).toUpperCase()}</div>
        <div class="user-item-info">
          <div class="user-item-name">
            ${user.username}
            ${user.id === currentUserId ? ' (você)' : ''}
          </div>
          <div class="user-item-status">
            <span class="status-icon ${user.muted ? 'active' : ''}" title="Mutado">🔇</span>
            <span class="status-icon ${user.deafened ? 'active' : ''}" title="Ensurdecido">🔕</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  setUserSpeaking(userId, isSpeaking) {
    const userElement = document.getElementById(`user-${userId}`);
    if (userElement) {
      userElement.classList.toggle('speaking', isSpeaking);
    }
  }

  addChatMessage(message, isOwn = false, isSystem = false) {
    const container = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    
    if (isSystem) {
      messageEl.className = 'chat-message system';
      messageEl.textContent = message.message;
    } else {
      messageEl.className = `chat-message ${isOwn ? 'own' : ''}`;
      messageEl.innerHTML = `
        <div class="chat-message-header">
          <span class="chat-message-author">${message.username}</span>
          <span class="chat-message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="chat-message-content">${this.escapeHtml(message.message)}</div>
      `;
    }
    
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  setRoomInfo(room, userCount) {
    document.getElementById('room-name').textContent = room.name;
    document.getElementById('room-user-count').textContent = `${userCount} usuário(s)`;
  }

  updateMuteButton(isMuted) {
    const btn = document.getElementById('mute-btn');
    btn.textContent = isMuted ? '🔇' : '🎤';
    btn.classList.toggle('muted', isMuted);
  }

  updateDeafenButton(isDeafened) {
    const btn = document.getElementById('deafen-btn');
    btn.textContent = isDeafened ? '🔕' : '🔊';
    btn.classList.toggle('deafened', isDeafened);
  }

  showRoomView() {
    document.getElementById('no-room-selected').classList.add('hidden');
    document.getElementById('room-container').classList.remove('hidden');
  }

  hideRoomView() {
    document.getElementById('no-room-selected').classList.remove('hidden');
    document.getElementById('room-container').classList.add('hidden');
    document.getElementById('chat-messages').innerHTML = '';
  }

  async loadAudioDevices(audioManager) {
    const devices = await audioManager.loadDevices();
    
    const inputSelect = document.getElementById('audio-input-select');
    inputSelect.innerHTML = devices.input.map(d => 
      `<option value="${d.deviceId}">${d.label || 'Microfone ' + d.deviceId.slice(0, 8)}</option>`
    ).join('');

    const outputSelect = document.getElementById('audio-output-select');
    outputSelect.innerHTML = devices.output.map(d => 
      `<option value="${d.deviceId}">${d.label || 'Alto-falante ' + d.deviceId.slice(0, 8)}</option>`
    ).join('');
  }

  startMicLevelMonitor(audioManager) {
    const levelBar = document.getElementById('mic-level');
    
    const update = () => {
      const level = audioManager.getAudioLevel();
      levelBar.style.width = `${level}%`;
      requestAnimationFrame(update);
    };
    
    update();
  }
}

window.uiManager = new UIManager();