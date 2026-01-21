/**
 * RATE LIMITING ROBUSTO
 * Proteção contra abuso com algoritmo Token Bucket
 */

class RobustRateLimiter {
  constructor() {
    this.buckets = new Map(); // key -> { tokens, lastRefill }
    this.limits = {
      'message': { maxTokens: 10, refillRate: 1 }, // 10 mensagens a cada 1 segundo
      'command': { maxTokens: 5, refillRate: 0.5 }, // 5 comandos a cada 2 segundos
      'media': { maxTokens: 5, refillRate: 0.2 }, // 5 mídia a cada 5 segundos
      'call': { maxTokens: 3, refillRate: 0.1 } // 3 chamadas a cada 10 segundos
    };
  }

  canProceed(userId, action) {
    const key = `${userId}:${action}`;
    const limit = this.limits[action];

    if (!limit) {
      console.warn(`⚠️ Ação desconhecida: ${action}`);
      return true;
    }

    const now = Date.now();
    let bucket = this.buckets.get(key);

    // Inicializar bucket se não existe
    if (!bucket) {
      bucket = {
        tokens: limit.maxTokens,
        lastRefill: now
      };
      this.buckets.set(key, bucket);
    }

    // Recarregar tokens baseado no tempo decorrido
    const timePassed = (now - bucket.lastRefill) / 1000; // em segundos
    bucket.tokens = Math.min(
      limit.maxTokens,
      bucket.tokens + (timePassed * limit.refillRate)
    );
    bucket.lastRefill = now;

    // Verificar se há tokens disponíveis
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  getStatus(userId, action) {
    const key = `${userId}:${action}`;
    const bucket = this.buckets.get(key);
    const limit = this.limits[action];

    if (!bucket || !limit) return null;

    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / 1000;
    const tokens = Math.min(
      limit.maxTokens,
      bucket.tokens + (timePassed * limit.refillRate)
    );

    return {
      action,
      currentTokens: Math.floor(tokens * 100) / 100,
      maxTokens: limit.maxTokens,
      refillRate: limit.refillRate,
      canProceed: tokens >= 1
    };
  }

  cleanup() {
    // Remover buckets inativos (sem uso por 1 hora)
    const now = Date.now();
    const oneHour = 3600000;

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > oneHour) {
        this.buckets.delete(key);
      }
    }
  }

  reset(userId) {
    const keysToDelete = [];
    
    for (const key of this.buckets.keys()) {
      if (key.startsWith(`${userId}:`)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.buckets.delete(key));
  }

  // Executar limpeza a cada 5 minutos
  startCleanup() {
    setInterval(() => this.cleanup(), 300000);
  }
}

window.rateLimiter = new RobustRateLimiter();
window.rateLimiter.startCleanup();
