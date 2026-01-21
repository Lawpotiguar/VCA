/**
 * STATUS PERSONALIZADOS
 * Sistema de status de usuário
 */

class UserStatusManager {
  constructor() {
    this.myStatus = 'online';
    this.statusOptions = {
      'online': { icon: '🟢', label: 'Online', color: '#4ade80' },
      'away': { icon: '🟡', label: 'Ausente', color: '#fbbf24' },
      'busy': { icon: '🔴', label: 'Ocupado', color: '#ef4444' },
      'dnd': { icon: '⛔', label: 'Não Perturbe', color: '#a78bfa' },
      'idle': { icon: '⚪', label: 'Inativo', color: '#9ca3af' }
    };
    this.customStatuses = new Map(); // userId -> custom status text
    this.userStatuses = new Map(); // userId -> status
    this.autoAwayTimeout = 5 * 60 * 1000; // 5 minutos
    this.idleTimer = null;
    this.lastActivityTime = Date.now();
  }

  init() {
    this.setupActivityTracking();
    this.loadSavedStatus();
    this.initStatusUI();
    console.log('✅ Sistema de status inicializado');
  }

  setupActivityTracking() {
    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, () => {
        this.lastActivityTime = Date.now();
        
        if (this.myStatus === 'away' || this.myStatus === 'idle') {
          this.setStatus('online');
        }
      });
    });

    // Verificar inatividade a cada 30 segundos
    setInterval(() => {
      const inactiveTime = Date.now() - this.lastActivityTime;
      
      if (inactiveTime > this.autoAwayTimeout && this.myStatus === 'online') {
        this.setStatus('away');
      }
    }, 30000);
  }

  setStatus(status, customText = '') {
    if (!this.statusOptions[status]) {
      console.warn(`⚠️ Status inválido: ${status}`);
      return false;
    }

    this.myStatus = status;
    
    if (customText) {
      this.customStatuses.set('me', customText);
    }

    this.saveStatus();
    this.updateStatusUI();

    // Notificar servidor
    if (window.socket) {
      window.socket.emit('user-status-change', {
        status: this.myStatus,
        customText: customText || null
      });
    }

    console.log(`📊 Status mudado para: ${this.statusOptions[status].label}`);
    return true;
  }

  setCustomStatus(text) {
    const maxLength = 50;
    if (text && text.length > maxLength) {
      text = text.substring(0, maxLength);
    }

    this.customStatuses.set('me', text);
    this.saveStatus();
    this.updateStatusUI();

    // Notificar servidor
    if (window.socket) {
      window.socket.emit('custom-status-change', text);
    }

    console.log(`💬 Status personalizado: ${text || '(removido)'}`);
  }

  getUserStatus(userId) {
    return this.userStatuses.get(userId) || 'offline';
  }

  getCustomStatus(userId) {
    return this.customStatuses.get(userId) || '';
  }

  setUserStatus(userId, status, customText = '') {
    if (this.statusOptions[status]) {
      this.userStatuses.set(userId, status);
      if (customText) {
        this.customStatuses.set(userId, customText);
      }
    }
  }

  getStatusDisplay(status) {
    return this.statusOptions[status] || this.statusOptions['offline'];
  }

  updateStatusUI() {
    const statusDisplay = this.getStatusDisplay(this.myStatus);
    const statusBtn = document.getElementById('status-btn');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    if (statusBtn) {
      statusIndicator.textContent = statusDisplay.icon;
      statusText.textContent = statusDisplay.label;
      statusBtn.style.borderColor = statusDisplay.color;
    }
  }

  initStatusUI() {
    const statusBtn = document.getElementById('status-btn');
    const statusMenu = document.getElementById('status-menu');

    if (statusBtn && statusMenu) {
      statusBtn.addEventListener('click', () => {
        statusMenu.classList.toggle('hidden');
      });

      // Botões de status
      statusMenu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const status = btn.dataset.status;
          this.setStatus(status);
          statusMenu.classList.add('hidden');
        });
      });

      // Fechar ao clicar fora
      document.addEventListener('click', (e) => {
        if (!statusBtn.contains(e.target) && !statusMenu.contains(e.target)) {
          statusMenu.classList.add('hidden');
        }
      });
    }
  }

  saveStatus() {
    localStorage.setItem('userStatus', JSON.stringify({
      status: this.myStatus,
      customText: this.customStatuses.get('me') || ''
    }));
  }

  loadSavedStatus() {
    try {
      const saved = localStorage.getItem('userStatus');
      if (saved) {
        const data = JSON.parse(saved);
        if (this.statusOptions[data.status]) {
          this.myStatus = data.status;
          if (data.customText) {
            this.customStatuses.set('me', data.customText);
          }
        }
      }
    } catch (error) {
      console.warn('⚠️ Erro ao carregar status salvo:', error);
    }

    this.updateStatusUI();
  }

  getStatusPanel() {
    const customText = this.customStatuses.get('me') || '';
    
    return `
      <div class="status-panel">
        <div class="status-header">
          <h3>Status Pessoal</h3>
        </div>

        <div class="status-current">
          <span class="status-icon">${this.getStatusDisplay(this.myStatus).icon}</span>
          <span class="status-name">${this.getStatusDisplay(this.myStatus).label}</span>
        </div>

        <input 
          type="text" 
          id="custom-status-input"
          placeholder="Adicione um status personalizado..."
          value="${customText}"
          maxlength="50"
          onchange="window.statusManager?.setCustomStatus(this.value)"
          class="custom-status-input"
        >

        <div class="status-options">
          ${Object.entries(this.statusOptions).map(([key, { icon, label }]) => `
            <button 
              class="status-option ${key === this.myStatus ? 'active' : ''}"
              onclick="window.statusManager?.setStatus('${key}')"
            >
              <span class="icon">${icon}</span>
              <span class="label">${label}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }
}

window.statusManager = new UserStatusManager();
