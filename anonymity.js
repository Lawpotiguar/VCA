/**
 * MÓDULO DE ANONIMIDADE
 * Gera IDs anônimos, códigos de sala e fingerprints
 */

const crypto = require('crypto');

const anonymity = {
  // Gera um ID anônimo único
  generateAnonymousId: () => {
    return crypto.randomBytes(16).toString('hex').substring(0, 12);
  },

  // Gera um código de sala 4 caracteres
  generateRoomCode: () => {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
  },

  // Gera fingerprint único para sessão
  generateSessionFingerprint: () => {
    return crypto.randomBytes(16).toString('hex');
  },

  // Hash de senha
  hashPassword: async (password) => {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha256');
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
  },

  // Verifica senha
  verifyPassword: async (password, hash) => {
    const [salt, storedHash] = hash.split(':');
    const saltBuffer = Buffer.from(salt, 'hex');
    const hashBuffer = crypto.pbkdf2Sync(password, saltBuffer, 1000, 64, 'sha256');
    return hashBuffer.toString('hex') === storedHash;
  },

  // Valida nome de usuário
  validateName: (name) => {
    if (!name) {
      return { success: true, name: `Anônimo#${Math.random().toString(36).substring(2, 6)}` };
    }
    
    const trimmed = name.trim().substring(0, 20);
    if (trimmed.length === 0) {
      return { success: true, name: `Anônimo#${Math.random().toString(36).substring(2, 6)}` };
    }
    
    return { success: true, name: trimmed };
  },

  // Sanitiza texto
  sanitizeText: (text, maxLength = 100) => {
    if (!text) return 'Sem nome';
    return text.trim().substring(0, maxLength).replace(/[<>]/g, '');
  }
};

module.exports = anonymity;
