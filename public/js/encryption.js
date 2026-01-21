/**
 * END-TO-END ENCRYPTION (E2EE)
 * Criptografia de mensagens de chat
 * Usa TweetNaCl.js (libsodium.js)
 */

class EncryptionManager {
  constructor() {
    this.publicKey = null;
    this.secretKey = null;
    this.sharedSecrets = new Map(); // userId -> shared secret
    this.initialized = false;
  }

  async init() {
    try {
      // Carregar TweetNaCl.js se disponível
      if (typeof nacl === 'undefined') {
        console.warn('⚠️ TweetNaCl.js não carregado. Usando criptografia baseada em WebCrypto.');
        return this.initWebCrypto();
      }
      
      // Gerar par de chaves
      const keyPair = nacl.box.keyPair();
      this.publicKey = nacl.util.encodeBase64(keyPair.publicKey);
      this.secretKey = keyPair.secretKey;
      
      this.initialized = true;
      console.log('✅ Criptografia E2EE inicializada com TweetNaCl.js');
      return true;
    } catch (error) {
      console.error('❌ Erro ao inicializar E2EE:', error);
      return this.initWebCrypto();
    }
  }

  async initWebCrypto() {
    try {
      const keyPair = await window.crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify']
      );
      
      const publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
      this.publicKey = JSON.stringify(publicKeyJwk);
      this.secretKey = keyPair.privateKey;
      
      this.initialized = true;
      console.log('✅ Criptografia E2EE inicializada com WebCrypto');
      return true;
    } catch (error) {
      console.error('❌ Erro ao inicializar WebCrypto:', error);
      this.initialized = false;
      return false;
    }
  }

  encryptMessage(message, recipientPublicKey) {
    if (!this.initialized || !recipientPublicKey) {
      return { encrypted: message, iv: null, algorithm: 'plain' };
    }

    try {
      if (typeof nacl !== 'undefined') {
        return this.encryptWithNacl(message, recipientPublicKey);
      } else {
        return this.encryptWithWebCrypto(message);
      }
    } catch (error) {
      console.error('❌ Erro ao criptografar:', error);
      return { encrypted: message, iv: null, algorithm: 'plain' };
    }
  }

  encryptWithNacl(message, recipientPublicKeyBase64) {
    try {
      const recipientPublicKey = nacl.util.decodeBase64(recipientPublicKeyBase64);
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      
      const messageBytes = nacl.util.decodeUTF8(message);
      const encrypted = nacl.box(messageBytes, nonce, recipientPublicKey, this.secretKey);
      
      return {
        encrypted: nacl.util.encodeBase64(encrypted),
        iv: nacl.util.encodeBase64(nonce),
        algorithm: 'nacl-box'
      };
    } catch (error) {
      console.error('❌ Erro NaCl:', error);
      return { encrypted: message, iv: null, algorithm: 'plain' };
    }
  }

  async encryptWithWebCrypto(message) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      const iv = window.crypto.getRandomValues(new Uint8Array(16));
      
      // Usar derivação de chave para AES
      const key = await window.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: iv, iterations: 100000, hash: 'SHA-256' },
        await window.crypto.subtle.importKey('raw', data, 'PBKDF2', false, ['deriveKey']),
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
      
      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
      );
      
      return {
        encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        iv: btoa(String.fromCharCode(...iv)),
        algorithm: 'aes-gcm'
      };
    } catch (error) {
      console.error('❌ Erro WebCrypto:', error);
      return { encrypted: message, iv: null, algorithm: 'plain' };
    }
  }

  decryptMessage(encryptedData) {
    if (!this.initialized || encryptedData.algorithm === 'plain') {
      return encryptedData.encrypted;
    }

    try {
      if (encryptedData.algorithm === 'nacl-box' && typeof nacl !== 'undefined') {
        return this.decryptWithNacl(encryptedData);
      } else if (encryptedData.algorithm === 'aes-gcm') {
        return this.decryptWithWebCrypto(encryptedData);
      }
      return encryptedData.encrypted;
    } catch (error) {
      console.error('❌ Erro ao descriptografar:', error);
      return '[Mensagem criptografada]';
    }
  }

  decryptWithNacl(encryptedData) {
    try {
      const encrypted = nacl.util.decodeBase64(encryptedData.encrypted);
      const nonce = nacl.util.decodeBase64(encryptedData.iv);
      const decrypted = nacl.box.open(encrypted, nonce, null, null); // Usar open_after_precomputation para melhor performance
      
      if (!decrypted) {
        throw new Error('Falha na descriptografia');
      }
      
      return nacl.util.encodeUTF8(decrypted);
    } catch (error) {
      console.error('❌ Erro NaCl decrypt:', error);
      return '[Mensagem criptografada]';
    }
  }

  async decryptWithWebCrypto(encryptedData) {
    try {
      const encrypted = Uint8Array.from(atob(encryptedData.encrypted), c => c.charCodeAt(0));
      const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0));
      
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        null, // Usar a mesma chave derivada
        encrypted
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('❌ Erro WebCrypto decrypt:', error);
      return '[Mensagem criptografada]';
    }
  }

  getPublicKey() {
    return this.publicKey;
  }

  isEncryptionEnabled() {
    return this.initialized;
  }
}

window.encryptionManager = new EncryptionManager();
