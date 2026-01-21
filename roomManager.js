const anonymity = require('./anonymity');

/**
 * GERENCIADOR DE SALAS ANÔNIMAS
 * - Tudo em memória (RAM)
 * - Auto-destruição de salas vazias
 * - Zero persistência
 */

class AnonymousRoomManager {
  constructor() {
    this.rooms = new Map();
    this.userSessions = new Map(); // socketId → userData

    // Criar salas padrão
    this.createDefaultRooms();
  }

  async createDefaultRooms() {
    await this.createRoom({ name: '🌐 Lobby Geral', permanent: true, maxUsers: 50 });
    await this.createRoom({ name: '🎮 Gaming', permanent: true, maxUsers: 30 });
    await this.createRoom({ name: '🎵 Música & Chill', permanent: true, maxUsers: 20 });
  }

  async createRoom(options) {
    const room = {
      id: anonymity.generateAnonymousId(),
      name: anonymity.sanitizeText(options.name || 'Sala Privada', 50),
      code: anonymity.generateRoomCode(),
      password: options.password ? await anonymity.hashPassword(options.password) : null,
      hasPassword: !!options.password,
      maxUsers: Math.min(Math.max(options.maxUsers || 10, 2), 100),
      ownerId: options.ownerId || null,
      permanent: options.permanent || false,
      users: [],
      bannedFingerprints: new Set(),
      moderators: new Set(),
      createdAt: Date.now()
    };

    this.rooms.set(room.id, room);

    // Auto-destruir salas vazias (exceto permanentes)
    if (!room.permanent) {
      this.scheduleCleanup(room.id);
    }

    return room;
  }

  scheduleCleanup(roomId) {
    setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (room && !room.permanent && room.users.length === 0) {
        this.rooms.delete(roomId);
        console.log(`🗑️ Sala vazia deletada: ${room.name}`);
      }
    }, 3600000); // 1 hora
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomByCode(code) {
    if (!code) return null;
    const upperCode = code.toUpperCase();
    
    for (const room of this.rooms.values()) {
      if (room.code === upperCode) {
        return room;
      }
    }
    return null;
  }

  getPublicRoomsList() {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      userCount: room.users.length,
      maxUsers: room.maxUsers,
      hasPassword: room.hasPassword,
      permanent: room.permanent
    }));
  }

  createAnonymousUser(socketId, name) {
    const user = {
      id: anonymity.generateAnonymousId(),
      socketId: socketId,
      name: anonymity.validateName(name).name,
      fingerprint: anonymity.generateSessionFingerprint(),
      muted: false,
      deafened: false,
      isOwner: false,
      isModerator: false
    };

    this.userSessions.set(socketId, user);
    return user;
  }

  getUser(socketId) {
    return this.userSessions.get(socketId);
  }

  getUserById(userId) {
    for (const user of this.userSessions.values()) {
      if (user.id === userId) return user;
    }
    return null;
  }

  removeUser(socketId) {
    const user = this.userSessions.get(socketId);
    if (user) {
      // Remover de todas as salas
      for (const room of this.rooms.values()) {
        room.users = room.users.filter(u => u.id !== user.id);
        
        // Deletar sala vazia não-permanente
        if (!room.permanent && room.users.length === 0) {
          this.rooms.delete(room.id);
        }
      }
      this.userSessions.delete(socketId);
    }
  }

  async joinRoom(roomId, user, password = null) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: 'Sala não encontrada' };
    }

    // Verificar ban
    if (room.bannedFingerprints.has(user.fingerprint)) {
      return { success: false, error: 'Você está banido desta sala' };
    }

    // Verificar senha
    if (room.hasPassword) {
      const validPassword = await anonymity.verifyPassword(password, room.password);
      if (!validPassword) {
        return { success: false, error: 'Senha incorreta' };
      }
    }

    // Verificar lotação
    if (room.users.length >= room.maxUsers) {
      return { success: false, error: 'Sala cheia' };
    }

    // Verificar se já está na sala
    if (room.users.some(u => u.id === user.id)) {
      return { success: false, error: 'Você já está nesta sala' };
    }

    // Definir permissões
    user.isOwner = room.ownerId === user.id;
    user.isModerator = room.ownerId === user.id || room.moderators.has(user.id);

    // Adicionar à sala
    room.users.push(user);

    return {
      success: true,
      room: {
        id: room.id,
        name: room.name,
        code: room.code,
        hasPassword: room.hasPassword,
        ownerId: room.ownerId,
        permanent: room.permanent
      },
      users: room.users.map(u => ({
        id: u.id,
        name: u.name,
        muted: u.muted,
        deafened: u.deafened,
        isOwner: u.isOwner,
        isModerator: u.isModerator
      })),
      isOwner: user.isOwner,
      isModerator: user.isModerator
    };
  }

  leaveRoom(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.users = room.users.filter(u => u.id !== userId);
      
      // Deletar sala vazia
      if (!room.permanent && room.users.length === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  isOwner(roomId, userId) {
    const room = this.rooms.get(roomId);
    return room && room.ownerId === userId;
  }

  isModerator(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.ownerId === userId || room.moderators.has(userId);
  }

  kickUser(roomId, targetId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const target = room.users.find(u => u.id === targetId);
    if (target && room.ownerId !== targetId) {
      room.users = room.users.filter(u => u.id !== targetId);
      return true;
    }
    return false;
  }

  banUser(roomId, targetId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    const target = room.users.find(u => u.id === targetId);
    if (target && room.ownerId !== targetId) {
      room.bannedFingerprints.add(target.fingerprint);
      room.users = room.users.filter(u => u.id !== targetId);
      return true;
    }
    return false;
  }

  promoteModerator(roomId, targetId) {
    const room = this.rooms.get(roomId);
    if (room && room.ownerId !== targetId) {
      room.moderators.add(targetId);
      const user = room.users.find(u => u.id === targetId);
      if (user) user.isModerator = true;
      return true;
    }
    return false;
  }

  demoteModerator(roomId, targetId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.moderators.delete(targetId);
      const user = room.users.find(u => u.id === targetId);
      if (user) user.isModerator = false;
      return true;
    }
    return false;
  }

  transferOwnership(roomId, newOwnerId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Remover status do dono atual
    const oldOwner = room.users.find(u => u.id === room.ownerId);
    if (oldOwner) oldOwner.isOwner = false;

    // Definir novo dono
    room.ownerId = newOwnerId;
    const newOwner = room.users.find(u => u.id === newOwnerId);
    if (newOwner) {
      newOwner.isOwner = true;
      newOwner.isModerator = true;
      room.moderators.add(newOwnerId);
    }

    return true;
  }

  async changePassword(roomId, newPassword) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.password = newPassword ? await anonymity.hashPassword(newPassword) : null;
      room.hasPassword = !!newPassword;
      return true;
    }
    return false;
  }

  changeRoomName(roomId, newName) {
    const room = this.rooms.get(roomId);
    if (room && !room.permanent) {
      room.name = anonymity.sanitizeText(newName, 50);
      return true;
    }
    return false;
  }

  regenerateCode(roomId) {
    const room = this.rooms.get(roomId);
    if (room) {
      room.code = anonymity.generateRoomCode();
      return room.code;
    }
    return null;
  }

  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (room && !room.permanent) {
      this.rooms.delete(roomId);
      return true;
    }
    return false;
  }

  getAllUsers() {
    return Array.from(this.userSessions.values());
  }

  getRoomsList() {
    return Array.from(this.rooms.values());
  }
}

module.exports = AnonymousRoomManager;