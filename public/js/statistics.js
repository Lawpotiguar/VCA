/**
 * STATISTICS DASHBOARD
 * Coleta e exibe estatísticas de uso
 */

class StatisticsDashboard {
  constructor() {
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      peersConnected: 0,
      totalDataSent: 0,
      totalDataReceived: 0,
      uptime: 0,
      audioQuality: 'unknown',
      roomsJoined: 0,
      usersEncountered: new Set(),
      startTime: Date.now()
    };
    this.messageHistory = [];
    this.connectionHistory = [];
  }

  recordMessageSent(size = 100) {
    this.stats.messagesReceived++;
    this.stats.totalDataSent += size;
    this.messageHistory.push({
      type: 'sent',
      timestamp: Date.now(),
      size
    });
  }

  recordMessageReceived(size = 100) {
    this.stats.messagesReceived++;
    this.stats.totalDataReceived += size;
    this.messageHistory.push({
      type: 'received',
      timestamp: Date.now(),
      size
    });
  }

  recordPeerConnected(userId) {
    this.stats.peersConnected++;
    this.stats.usersEncountered.add(userId);
    this.connectionHistory.push({
      userId,
      action: 'connected',
      timestamp: Date.now()
    });
  }

  recordPeerDisconnected(userId) {
    if (this.stats.peersConnected > 0) {
      this.stats.peersConnected--;
    }
    this.connectionHistory.push({
      userId,
      action: 'disconnected',
      timestamp: Date.now()
    });
  }

  recordRoomJoined() {
    this.stats.roomsJoined++;
  }

  updateAudioQuality(quality) {
    this.stats.audioQuality = quality;
  }

  getStats() {
    return {
      ...this.stats,
      uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      uniqueUsers: this.stats.usersEncountered.size,
      totalDataSentMB: (this.stats.totalDataSent / 1024 / 1024).toFixed(2),
      totalDataReceivedMB: (this.stats.totalDataReceived / 1024 / 1024).toFixed(2)
    };
  }

  getMessageHistory() {
    return this.messageHistory.slice(-50); // Últimas 50 mensagens
  }

  getConnectionHistory() {
    return this.connectionHistory.slice(-100); // Últimas 100 conexões
  }

  getSessionSummary() {
    const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    const avgMessageSize = this.stats.messagesReceived > 0
      ? (this.stats.totalDataReceived / this.stats.messagesReceived).toFixed(2)
      : 0;

    return {
      uptime: `${hours}h ${minutes}m ${seconds}s`,
      totalMessages: this.stats.messagesReceived,
      totalPeersConnected: this.stats.usersEncountered.size,
      averageMessageSize: `${avgMessageSize} bytes`,
      totalDataTransferred: `${(
        (this.stats.totalDataSent + this.stats.totalDataReceived) / 1024 / 1024
      ).toFixed(2)} MB`,
      roomsVisited: this.stats.roomsJoined,
      sessionAudioQuality: this.stats.audioQuality
    };
  }

  renderDashboard() {
    const stats = this.getStats();
    const summary = this.getSessionSummary();

    return `
      <div class="dashboard-container">
        <div class="dashboard-header">
          <h2>📊 Estatísticas da Sessão</h2>
          <button class="close-btn" onclick="this.parentElement.parentElement.classList.add('hidden')">✕</button>
        </div>

        <div class="dashboard-grid">
          <div class="stat-card">
            <div class="stat-icon">📤</div>
            <div class="stat-content">
              <span class="stat-label">Mensagens Enviadas</span>
              <span class="stat-value">${stats.messagesReceived}</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">👥</div>
            <div class="stat-content">
              <span class="stat-label">Usuários Únicos</span>
              <span class="stat-value">${stats.uniqueUsers}</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">🏠</div>
            <div class="stat-content">
              <span class="stat-label">Salas Visitadas</span>
              <span class="stat-value">${stats.roomsJoined}</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">⏱️</div>
            <div class="stat-content">
              <span class="stat-label">Tempo Online</span>
              <span class="stat-value">${summary.uptime}</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">📡</div>
            <div class="stat-content">
              <span class="stat-label">Dados Transferidos</span>
              <span class="stat-value">${summary.totalDataTransferred}</span>
            </div>
          </div>

          <div class="stat-card">
            <div class="stat-icon">🎵</div>
            <div class="stat-content">
              <span class="stat-label">Qualidade de Áudio</span>
              <span class="stat-value">${stats.audioQuality}</span>
            </div>
          </div>
        </div>

        <div class="dashboard-footer">
          <p>Estatísticas coletadas durante esta sessão</p>
        </div>
      </div>
    `;
  }
}

window.StatisticsDashboard = StatisticsDashboard;
