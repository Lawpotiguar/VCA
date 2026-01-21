/**
 * SERVIDOR VOICECHAT ANÔNIMO
 * Zero logs, zero IP tracking, 100% privado
 */

// Carregar variáveis de ambiente
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const AnonymousRoomManager = require('./roomManager');
const anonymity = require('./anonymity');

const app = express();
const server = http.createServer(app);

// Configuração de CORS mais segura
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? ['https://*.onrender.com', 'https://*.herokuapp.com']
  : ['http://localhost:3000', 'http://localhost:*'];

const io = new Server(server, {
  cors: { 
    origin: "*", // Funciona em desenvolvimento e produção
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 10e6 // 10MB
});

// Configurar diretório de uploads
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware para body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos e SPA
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

const roomManager = new AnonymousRoomManager();

// Conexões Socket.io
io.on('connection', (socket) => {
  let currentUser = null;
  let currentRoomId = null;
  let userPublicKey = null; // Armazenar chave pública do cliente

  // === REGISTRO ANÔNIMO ===
  socket.on('register', (name, callback) => {
    currentUser = roomManager.createAnonymousUser(socket.id, name);
    console.log(`👤 ${currentUser.name} conectou`);
    
    callback({ 
      success: true, 
      user: { 
        id: currentUser.id, 
        name: currentUser.name 
      } 
    });
    
    socket.emit('rooms-update', roomManager.getPublicRoomsList());
    
    // Enviar lista de usuários online para o cliente
    emitOnlineUsers();
  });

  // === COMPARTILHAR CHAVE PÚBLICA ===
  socket.on('share-public-key', (publicKey) => {
    if (!currentUser) return;
    
    userPublicKey = publicKey;
    console.log(`🔑 Chave pública recebida de ${currentUser.name}`);
    
    // Enviar essa chave para todos os outros usuários online
    socket.broadcast.emit('public-key-shared', {
      userId: currentUser.id,
      publicKey: publicKey,
      userName: currentUser.name
    });
  });

  // === CRIAR SALA ===
  socket.on('create-room', async (data, callback) => {
    if (!currentUser) return callback({ success: false, error: 'Não autenticado' });

    const room = await roomManager.createRoom({
      name: data.name,
      password: data.password,
      maxUsers: data.maxUsers,
      ownerId: currentUser.id
    });

    console.log(`🏠 Sala criada: ${room.name} por ${currentUser.name}`);
    
    io.emit('rooms-update', roomManager.getPublicRoomsList());
    
    callback({ 
      success: true, 
      room: { 
        id: room.id, 
        name: room.name, 
        code: room.code 
      } 
    });
  });

  // === ENTRAR NA SALA ===
  socket.on('join-room', async (data, callback) => {
    if (!currentUser) return callback({ success: false, error: 'Não autenticado' });

    // Sair da sala atual SEM emitir rooms-update ainda
    const previousRoomId = currentRoomId;
    if (currentRoomId) {
      leaveCurrentRoom(false); // false = não emitir rooms-update aqui
    }

    // Buscar sala por ID ou código
    let room;
    if (data.code) {
      room = roomManager.getRoomByCode(data.code);
    } else {
      room = roomManager.getRoom(data.roomId);
    }

    if (!room) {
      return callback({ success: false, error: 'Sala não encontrada' });
    }

    // Tentar entrar
    const result = await roomManager.joinRoom(room.id, currentUser, data.password);
    
    if (!result.success) {
      return callback(result);
    }

    // Sucesso
    currentRoomId = room.id;
    socket.join(room.id);

    console.log(`➡️ ${currentUser.name} entrou em ${room.name}`);

    // Notificar outros usuários da sala anterior que o usuário saiu
    if (previousRoomId) {
      socket.to(previousRoomId).emit('user-left', { 
        userId: currentUser.id,
        name: currentUser.name
      });
    }

    // Notificar outros usuários da nova sala que o usuário entrou
    socket.to(room.id).emit('user-joined', {
      user: {
        id: currentUser.id,
        name: currentUser.name,
        muted: currentUser.muted,
        deafened: currentUser.deafened
      }
    });

    // Emitir apenas UMA rooms-update após sair da sala anterior e entrar na nova
    io.emit('rooms-update', roomManager.getPublicRoomsList());

    // Enviar lista atualizada de usuários para a sala
    const updatedRoom = roomManager.getRoom(room.id);
    if (updatedRoom) {
      io.to(room.id).emit('users-update', updatedRoom.users.map(u => ({
        id: u.id,
        name: u.name,
        muted: u.muted,
        deafened: u.deafened,
        isOwner: u.isOwner,
        isModerator: u.isModerator
      })));
    }

    emitOnlineUsers(); // Atualizar lista de usuários online

    callback(result);
  });

  // === SAIR DA SALA ===
  socket.on('leave-room', () => {
    leaveCurrentRoom(true); // true = emitir rooms-update
  });

  function leaveCurrentRoom(emitUpdate = true) {
    if (!currentRoomId || !currentUser) return;

    const room = roomManager.getRoom(currentRoomId);
    
    roomManager.leaveRoom(currentRoomId, currentUser.id);
    socket.leave(currentRoomId);

    console.log(`⬅️ ${currentUser.name} saiu de ${room?.name || 'sala'}`);

    socket.to(currentRoomId).emit('user-left', { 
      userId: currentUser.id,
      name: currentUser.name
    });

    if (emitUpdate) {
      io.emit('rooms-update', roomManager.getPublicRoomsList());
      emitOnlineUsers(); // Atualizar lista de online
    }
    
    currentRoomId = null;
    currentUser.isOwner = false;
    currentUser.isModerator = false;
  }

  // === MODERAÇÃO ===

  socket.on('kick-user', (targetId, callback) => {
    if (!currentRoomId || !roomManager.isModerator(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Sem permissão' });
    }

    const success = roomManager.kickUser(currentRoomId, targetId);
    
    if (success) {
      const targetUser = roomManager.getUserById(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit('kicked', { 
          roomName: roomManager.getRoom(currentRoomId)?.name 
        });
        
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          targetSocket.leave(currentRoomId);
        }
      }
      
      socket.to(currentRoomId).emit('user-kicked', { userId: targetId });
      updateRoomUsers();
    }
    
    callback({ success });
  });

  socket.on('ban-user', (targetId, callback) => {
    if (!currentRoomId || !roomManager.isModerator(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Sem permissão' });
    }

    const success = roomManager.banUser(currentRoomId, targetId);
    
    if (success) {
      const targetUser = roomManager.getUserById(targetId);
      if (targetUser) {
        io.to(targetUser.socketId).emit('banned', { 
          roomName: roomManager.getRoom(currentRoomId)?.name 
        });
        
        const targetSocket = io.sockets.sockets.get(targetUser.socketId);
        if (targetSocket) {
          targetSocket.leave(currentRoomId);
        }
      }
      
      socket.to(currentRoomId).emit('user-banned', { userId: targetId });
      updateRoomUsers();
    }
    
    callback({ success });
  });

  socket.on('promote-moderator', (targetId, callback) => {
    if (!currentRoomId || !roomManager.isOwner(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Apenas o dono pode promover' });
    }

    const success = roomManager.promoteModerator(currentRoomId, targetId);
    if (success) {
      updateRoomUsers();
    }
    
    callback({ success });
  });

  socket.on('demote-moderator', (targetId, callback) => {
    if (!currentRoomId || !roomManager.isOwner(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Apenas o dono pode rebaixar' });
    }

    const success = roomManager.demoteModerator(currentRoomId, targetId);
    if (success) {
      updateRoomUsers();
    }
    
    callback({ success });
  });

  socket.on('transfer-ownership', (targetId, callback) => {
    if (!currentRoomId || !roomManager.isOwner(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Apenas o dono pode transferir' });
    }

    const success = roomManager.transferOwnership(currentRoomId, targetId);
    if (success) {
      currentUser.isOwner = false;
      updateRoomUsers();
    }
    
    callback({ success });
  });

  // === CONFIGURAÇÕES DA SALA ===

  socket.on('change-password', async (newPassword, callback) => {
    if (!currentRoomId || !roomManager.isOwner(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Sem permissão' });
    }

    await roomManager.changePassword(currentRoomId, newPassword);
    io.emit('rooms-update', roomManager.getPublicRoomsList());
    
    callback({ success: true });
  });

  socket.on('change-room-name', (newName, callback) => {
    if (!currentRoomId || !roomManager.isOwner(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Sem permissão' });
    }

    const success = roomManager.changeRoomName(currentRoomId, newName);
    if (success) {
      io.to(currentRoomId).emit('room-name-changed', { name: newName });
      io.emit('rooms-update', roomManager.getPublicRoomsList());
    }
    
    callback({ success });
  });

  socket.on('regenerate-code', (callback) => {
    if (!currentRoomId || !roomManager.isOwner(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Sem permissão' });
    }

    const newCode = roomManager.regenerateCode(currentRoomId);
    callback({ success: true, code: newCode });
  });

  socket.on('delete-room', (callback) => {
    if (!currentRoomId || !roomManager.isOwner(currentRoomId, currentUser?.id)) {
      return callback({ success: false, error: 'Sem permissão' });
    }

    const room = roomManager.getRoom(currentRoomId);
    if (room?.permanent) {
      return callback({ success: false, error: 'Sala permanente não pode ser deletada' });
    }

    io.to(currentRoomId).emit('room-deleted');
    roomManager.deleteRoom(currentRoomId);
    io.emit('rooms-update', roomManager.getPublicRoomsList());
    
    currentRoomId = null;
    callback({ success: true });
  });

  // === CHAT ===

  socket.on('chat-message', (message) => {
    if (!currentRoomId || !currentUser) return;

    const cleanMessage = anonymity.sanitizeText(message, 500);
    if (!cleanMessage) return;

    io.to(currentRoomId).emit('chat-message', {
      userId: currentUser.id,
      name: currentUser.name,
      message: cleanMessage,
      isOwner: currentUser.isOwner,
      isModerator: currentUser.isModerator
    });
  });

  // === CHAT PRIVADO (DM) ===

  socket.on('private-message', (data) => {
    if (!currentUser) return;

    const { recipientId, message, encrypted } = data;
    
    // Se for texto simples, sanitizar. Se for criptografado, passar como está
    let finalMessage = message;
    if (!encrypted && typeof message === 'string') {
      finalMessage = anonymity.sanitizeText(message, 500);
      if (!finalMessage) return;
    }

    // Encontrar socket do destinatário
    const recipientUser = roomManager.getUserById(recipientId);
    if (!recipientUser) {
      console.log('❌ Usuário destinatário não encontrado');
      return;
    }

    const recipientSocket = io.sockets.sockets.get(recipientUser.socketId);
    if (!recipientSocket) {
      console.log('❌ Socket do destinatário não encontrado');
      return;
    }

    // Enviar mensagem privada
    recipientSocket.emit('private-message', {
      senderId: currentUser.id,
      senderName: currentUser.name,
      message: finalMessage,
      encrypted: encrypted || false,
      timestamp: Date.now()
    });

    const encryptionStatus = encrypted ? '🔐' : '📝';
    console.log(`💬 ${encryptionStatus} DM: ${currentUser.name} → ${recipientUser.name}`);
  });

  // === ÁUDIO ===

  socket.on('audio-status', (status) => {
    if (!currentUser || !currentRoomId) return;

    currentUser.muted = !!status.muted;
    currentUser.deafened = !!status.deafened;

    socket.to(currentRoomId).emit('user-audio-status', {
      userId: currentUser.id,
      muted: currentUser.muted,
      deafened: currentUser.deafened
    });
  });

  socket.on('speaking', (isSpeaking) => {
    if (!currentRoomId || !currentUser) return;

    socket.to(currentRoomId).emit('user-speaking', {
      userId: currentUser.id,
      isSpeaking: !!isSpeaking
    });
  });

  // === WEBRTC SIGNALING ===

  socket.on('webrtc-offer', (data) => {
    if (!data.targetId) return;
    
    const targetUser = roomManager.getUserById(data.targetId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('webrtc-offer', {
        offer: data.offer,
        senderId: currentUser.id
      });
    }
  });

  socket.on('webrtc-answer', (data) => {
    if (!data.targetId) return;
    
    const targetUser = roomManager.getUserById(data.targetId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('webrtc-answer', {
        answer: data.answer,
        senderId: currentUser.id
      });
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    if (!data.targetId) return;
    
    const targetUser = roomManager.getUserById(data.targetId);
    if (targetUser) {
      io.to(targetUser.socketId).emit('webrtc-ice-candidate', {
        candidate: data.candidate,
        senderId: currentUser.id
      });
    }
  });

  // === ESTATÍSTICAS DO SERVIDOR ===
  socket.on('get-server-stats', (callback) => {
    const stats = {
      currentUsers: roomManager.getAllUsers().length,
      totalRooms: roomManager.getRoomsList().length,
      totalConnections: io.engine.clientsCount,
      peakUsers: roomManager.getAllUsers().length, // Pode ser expandido para histórico
      uptime: process.uptime() * 1000, // em ms
      avgRoomSize: calculateAverageRoomSize()
    };
    
    callback(stats);
  });

  function calculateAverageRoomSize() {
    const rooms = roomManager.getRoomsList();
    if (rooms.length === 0) return 0;
    
    const totalUsers = rooms.reduce((sum, room) => sum + room.users.length, 0);
    return totalUsers / rooms.length;
  }

  // === DESCONEXÃO ===

  socket.on('disconnect', () => {
    if (currentUser) {
      console.log(`❌ ${currentUser.name} desconectou`);
      leaveCurrentRoom(true); // true = emitir rooms-update
      roomManager.removeUser(socket.id);
      emitOnlineUsers(); // Atualizar lista de online
    }
  });

  // Helper para emitir lista de usuários online
  function emitOnlineUsers() {
    const onlineUsers = Array.from(roomManager.userSessions.values()).map(user => ({
      id: user.id,
      name: user.name,
      muted: user.muted,
      deafened: user.deafened
    }));
    io.emit('online-users', onlineUsers);
  }  // Helper
  function updateRoomUsers() {
    const room = roomManager.getRoom(currentRoomId);
    if (room) {
      io.to(currentRoomId).emit('users-update', room.users.map(u => ({
        id: u.id,
        name: u.name,
        muted: u.muted,
        deafened: u.deafened,
        isOwner: u.isOwner,
        isModerator: u.isModerator
      })));
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🔒 VOICECHAT ANÔNIMO RODANDO                           ║
║                                                           ║
║   Servidor online na porta ${PORT}                          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});