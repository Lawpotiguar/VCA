/**
 * CONNECTION QUALITY MONITOR
 * Monitora qualidade da conexão WebRTC
 */

class ConnectionQualityMonitor {
  constructor(socket) {
    this.socket = socket;
    this.stats = {
      ping: 0,
      jitter: 0,
      packetLoss: 0,
      bandwidth: 0,
      audioQuality: 'unknown'
    };
    this.peerStats = new Map(); // userId -> stats
    this.lastPings = [];
    this.monitoring = false;
  }

  start() {
    if (this.monitoring) return;
    
    this.monitoring = true;
    this.monitorPing();
    this.monitorPeerConnections();
    console.log('📊 Monitor de qualidade iniciado');
  }

  stop() {
    this.monitoring = false;
  }

  monitorPing() {
    if (!this.monitoring) return;

    const startTime = performance.now();
    
    this.socket.emit('ping', () => {
      const latency = performance.now() - startTime;
      this.stats.ping = Math.round(latency);
      
      // Calcular jitter (variação de latência)
      this.lastPings.push(this.stats.ping);
      if (this.lastPings.length > 10) this.lastPings.shift();
      
      const avg = this.lastPings.reduce((a, b) => a + b) / this.lastPings.length;
      this.stats.jitter = Math.round(
        Math.sqrt(this.lastPings.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / this.lastPings.length)
      );
      
      this.updateQualityIndicator();
    });

    setTimeout(() => this.monitorPing(), 5000); // A cada 5 segundos
  }

  monitorPeerConnections() {
    if (!this.monitoring) return;

    // Monitorar estatísticas de WebRTC para cada peer
    const checkStats = async () => {
      if (!window.peers) {
        setTimeout(checkStats, 1000);
        return;
      }

      for (const [userId, pc] of Object.entries(window.peers || {})) {
        try {
          const stats = await pc.getStats();
          
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
              this.peerStats.set(userId, {
                bytesReceived: report.bytesReceived,
                packetsLost: report.packetsLost,
                jitter: report.jitter || 0,
                audioLevel: report.audioLevel || 0
              });
            }
          });
        } catch (error) {
          console.warn(`⚠️ Erro ao obter stats de ${userId}:`, error);
        }
      }

      if (this.monitoring) {
        setTimeout(checkStats, 2000);
      }
    };

    checkStats();
  }

  updateQualityIndicator() {
    let quality = 'Excelente';
    let icon = '🟢';

    if (this.stats.ping > 150 || this.stats.jitter > 50) {
      quality = 'Bom';
      icon = '🟡';
    }
    if (this.stats.ping > 300 || this.stats.jitter > 100) {
      quality = 'Ruim';
      icon = '🔴';
    }
    if (this.stats.ping > 500) {
      quality = 'Péssimo';
      icon = '❌';
    }

    this.stats.audioQuality = quality;

    // Atualizar UI
    const qualityDiv = document.getElementById('connection-quality');
    if (qualityDiv) {
      qualityDiv.classList.remove('hidden');
      document.getElementById('quality-icon').textContent = icon;
      document.getElementById('quality-text').textContent = quality;
      document.getElementById('quality-ping').textContent = `${this.stats.ping}ms`;
    }

    return { quality, icon, ...this.stats };
  }

  getStats() {
    return this.stats;
  }

  getPeerStats(userId) {
    return this.peerStats.get(userId) || null;
  }

  getAllStats() {
    return {
      local: this.stats,
      peers: Object.fromEntries(this.peerStats)
    };
  }
}

window.ConnectionQualityMonitor = ConnectionQualityMonitor;
