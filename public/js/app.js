/**
 * VOICECHAT ANÔNIMO - CLIENT SIDE
 * 100% WebRTC P2P
 */

const socket = io();

// Estado global
let myUser = null;
let currentRoom = null;
let pendingRoomJoinId = null; // Armazena ID da sala sendo acessada (para evitar race condition)
let peers = {};
let localStream = null;
let speakingInterval = null;
let selectedUserId = null;
let isMuted = false;
let isDeafened = false;
let currentRoomPassword = null;
let audioContext = null; // AudioContext para análise de áudio
let enableSoundNotifications = true; // Som ativado por padrão

// Estado de chat privado
let currentDMUserId = null;
let dmConversations = {}; // { userId: [messages] }

// ==================== INICIALIZAÇÃO ====================

document.getElementById('enter-btn').addEventListener('click', () => {
  const name = document.getElementById('username-input').value.trim() || null;
  
  socket.emit('register', name, async (response) => {
    if (response.success) {
      myUser = response.user;
      document.getElementById('current-username').textContent = myUser.name;
      
      // Inicializar encryption manager
      const encryptionInitialized = await window.encryptionManager.init();
      if (encryptionInitialized) {
        console.log('✅ E2E Encryption ativada');
        // Compartilhar chave pública com servidor
        socket.emit('share-public-key', window.encryptionManager.getPublicKey());
      }
      
      showScreen('main-screen');
      restoreAudioSettings();
      initAudio();
    }
  });
});

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// Event listener para aba "Sala"
document.getElementById('tab-room').addEventListener('click', () => {
  switchTab('room');
});

// ==================== ÁUDIO ====================

async function initAudio() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    console.log('✅ Microfone OK');
  } catch (err) {
    console.warn('⚠️ Sem microfone:', err);
    showNotification('Microfone não disponível. Você só poderá ouvir.', 'warning');
  }
}

// ==================== SALAS ====================

socket.on('rooms-update', (rooms) => {
  const container = document.getElementById('rooms-list');
  
  if (!rooms || rooms.length === 0) {
    container.innerHTML = '<p style="text-align:center;opacity:0.5;">Nenhuma sala disponível</p>';
    return;
  }
  
  container.innerHTML = rooms.map(room => {
    // Se há uma transição em andamento (pendingRoomJoinId), usar apenas ela
    // Caso contrário, usar currentRoom
    let isActiveRoom = false;
    
    if (pendingRoomJoinId) {
      // Durante transição, apenas a sala sendo acessada é ativa
      isActiveRoom = pendingRoomJoinId === room.id;
    } else if (currentRoom) {
      // Sem transição, usar a sala atual
      isActiveRoom = currentRoom.id === room.id;
    }
    
    const disabledClass = isActiveRoom ? 'disabled' : '';
    const onClickAttr = isActiveRoom ? '' : `onclick="attemptJoinRoom('${room.id}', ${room.hasPassword}, ${room.permanent})"`;
    
    return `
    <div class="room-card ${disabledClass}" ${onClickAttr} title="${isActiveRoom ? 'Você já está nesta sala' : ''}">
      <div class="room-name">${escapeHtml(room.name)}</div>
      <div class="room-info">
        <span>${room.userCount}/${room.maxUsers}</span>
        ${room.hasPassword ? '<span class="lock">🔒</span>' : ''}
        ${isActiveRoom ? '<span class="current-room">✓ Atual</span>' : ''}
      </div>
    </div>
  `;
  }).join('');
});

function attemptJoinRoom(roomId, hasPassword, isPermanent = false) {
  // Verificar se já está tentando acessar uma sala diferente
  if (pendingRoomJoinId && pendingRoomJoinId !== roomId) {
    console.warn(`⚠️ Já está tentando acessar outra sala: ${pendingRoomJoinId}. Cancelando.`);
    return;
  }
  
  // Verificar se já está tentando acessar essa mesma sala (clique duplicado)
  if (pendingRoomJoinId === roomId) {
    return;
  }
  
  // Verificar se está em uma sala vazia ANTES de entrar em outra
  // Mas APENAS se a sala atual não for permanente
  const userCount = document.getElementById('user-count')?.textContent || '0';
  const isCurrentRoomEmpty = parseInt(userCount) <= 1 && currentRoom;
  const isCurrentRoomPermanent = currentRoom?.permanent === true;
  
  // Só mostrar alerta se a sala atual NÃO é permanente e está vazia
  if (isCurrentRoomEmpty && !isCurrentRoomPermanent && currentRoom?.id !== roomId) {
    // Mostrar confirmação
    showConfirmModal(
      '⚠️ Sala será deletada',
      `A sala "${currentRoom.name}" será deletada ao sair.\n\nDeseja continuar?`
    ).then((confirmed) => {
      if (!confirmed) return;
      
      // Sair da sala vazia e entrar na nova
      socket.emit('leave-room');
      resetRoomUI();
      proceedToJoinRoom(roomId, hasPassword);
    });
  } else {
    proceedToJoinRoom(roomId, hasPassword);
  }
}

function proceedToJoinRoom(roomId, hasPassword) {
  let password = null;
  
  if (hasPassword) {
    password = prompt('🔒 Digite a senha da sala:');
    if (password === null) return; // Usuário cancelou
    if (password === '') {
      showNotification('Digite a senha da sala', 'error');
      return;
    }
  }
  
  joinRoom(roomId, password);
}

function migrateDMsFromStandaloneToRoom() {
  // Se há DMs abertos no modo standalone, migrar para abas da sala
  const standaloneTabs = document.querySelectorAll('[data-dm-user-standalone]');
  
  if (standaloneTabs.length === 0) return; // Nenhum DM standalone aberto
  
  standaloneTabs.forEach(tab => {
    const userId = tab.getAttribute('data-dm-user-standalone');
    const userName = tab.textContent.replace('💬', '').replace('✕', '').trim();
    
    // Criar a aba no room
    createOrActivateDMTab(userId, userName);
  });
  
  // Fechar o DM container standalone
  closeDMContainer();
  
  // Limpar as abas standalone
  const standaloneTabs2 = document.querySelectorAll('[data-dm-user-standalone]');
  standaloneTabs2.forEach(tab => tab.remove());
  
  const standaloneViews = document.querySelectorAll('[data-dm-view-standalone]');
  standaloneViews.forEach(view => view.remove());
}

function joinRoom(roomId, password = null) {
  // Armazenar ID da sala que está sendo acessada (para evitar cliques duplicados)
  pendingRoomJoinId = roomId;
  
  socket.emit('join-room', { roomId, password }, (response) => {
    if (!response.success) {
      showNotification(response.error || 'Erro ao entrar na sala', 'error');
      pendingRoomJoinId = null; // Limpar imediatamente se falhar
      return;
    }
    
    // Migrar DMs standalone para abas da sala
    migrateDMsFromStandaloneToRoom();
    
    currentRoom = response.room;
    // Limpar APENAS se for a mesma sala que foi requisitada
    if (pendingRoomJoinId === roomId) {
      pendingRoomJoinId = null;
    }
    
    document.getElementById('no-room-selected').classList.add('hidden');
    document.getElementById('room-container').classList.remove('hidden');
    
    document.getElementById('room-title').textContent = currentRoom.name;
    document.getElementById('owner-badge').classList.toggle('hidden', !response.isOwner);
    document.getElementById('mod-badge').classList.toggle('hidden', !response.isModerator);
    document.getElementById('settings-room-btn').classList.toggle('hidden', !response.isOwner);
    
    updateUsers(response.users);
    connectToAllPeers(response.users);
    startSpeakingDetection();
    
    showNotification(`Entrou em ${currentRoom.name}`, 'success');
  });
}

// Função para mostrar modal de confirmação
function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    
    // Remover listeners antigos
    const confirmOkBtn = document.getElementById('confirm-ok');
    const confirmCancelBtn = document.getElementById('confirm-cancel');
    
    const okHandler = () => {
      modal.classList.add('hidden');
      confirmOkBtn.removeEventListener('click', okHandler);
      confirmCancelBtn.removeEventListener('click', cancelHandler);
      resolve(true);
    };
    
    const cancelHandler = () => {
      modal.classList.add('hidden');
      confirmOkBtn.removeEventListener('click', okHandler);
      confirmCancelBtn.removeEventListener('click', cancelHandler);
      resolve(false);
    };
    
    confirmOkBtn.addEventListener('click', okHandler);
    confirmCancelBtn.addEventListener('click', cancelHandler);
    
    // Fechar ao clicar no overlay
    modal.querySelector('.modal-overlay').addEventListener('click', cancelHandler, { once: true });
    
    modal.classList.remove('hidden');
  });
}

document.getElementById('leave-btn').addEventListener('click', async () => {
  // Verificar se a sala está vazia (só o usuário atual)
  const userCount = document.getElementById('user-count')?.textContent || '0';
  const isRoomEmpty = parseInt(userCount) <= 1; // Apenas o próprio usuário
  const isPermanent = currentRoom?.permanent === true; // Verificar se é permanente
  
  // Só mostrar alerta se a sala NÃO é permanente e está vazia
  if (isRoomEmpty && currentRoom && !isPermanent) {
    // Mostrar modal de confirmação
    const confirmed = await showConfirmModal(
      '⚠️ Sala será deletada',
      `A sala "${currentRoom.name}" será deletada ao sair.\n\nTem certeza que deseja sair?`
    );
    
    if (!confirmed) {
      return; // Cancelar saída
    }
  }
  
  socket.emit('leave-room');
  resetRoomUI();
  showNotification('Você saiu da sala', 'info');
});

function resetRoomUI() {
  // Migrar DMs da sala para standalone (se houver algum aberto)
  const roomDMs = document.querySelectorAll('[data-dm-user]');
  if (roomDMs.length > 0) {
    // Hay DMs abertos na sala, migrar para standalone
    roomDMs.forEach(tab => {
      const userId = tab.getAttribute('data-dm-user');
      const userName = tab.textContent.replace('💬', '').replace('✕', '').trim();
      
      // Criar no standalone
      createOrActivateDMTabStandalone(userId, userName);
    });
    
    // Mostrar o DM container
    showDMContainer();
    
    // Limpar as abas e views da sala
    const roomDMTabs = document.querySelectorAll('[data-dm-user]');
    roomDMTabs.forEach(tab => tab.remove());
    
    const roomDMViews = document.querySelectorAll('[data-dm-view]');
    roomDMViews.forEach(view => view.remove());
  }
  
  document.getElementById('no-room-selected').classList.remove('hidden');
  document.getElementById('room-container').classList.add('hidden');
  document.getElementById('chat-messages').innerHTML = '';
  currentRoom = null;
  pendingRoomJoinId = null; // Limpar ID da sala pendente
  closeAllPeerConnections();
  stopSpeakingDetection();
}

// ==================== USUÁRIOS ====================

function updateUsers(users) {
  console.log('[DEBUG] updateUsers chamado com:', users.length, 'usuários', users);
  const container = document.getElementById('users-list');
  const count = document.getElementById('user-count');
  
  count.textContent = users.length;
  
  container.innerHTML = users.map(user => {
    const isMe = user.id === myUser.id;
    const classes = ['user'];
    if (isMe) classes.push('me');
    if (user.isOwner) classes.push('owner');
    if (user.isModerator) classes.push('mod');
    
    let statusClass = 'status';
    if (user.muted) statusClass += ' muted';
    if (user.deafened) statusClass += ' deaf';
    
    return `
      <div class="${classes.join(' ')}" 
           data-user-id="${user.id}"
           ${!isMe ? `oncontextmenu="return openUserContextMenu(event, '${user.id}')"` : ''}>
        <span class="${statusClass}"></span>
        <span class="name">
          ${escapeHtml(user.name)}
          ${user.isOwner ? '👑' : user.isModerator ? '⭐' : ''}
          ${isMe ? ' (você)' : ''}
        </span>
      </div>
    `;
  }).join('');
}

function updateOnlineUsers(users) {
  const container = document.getElementById('online-users');
  if (!container) return;
  
  // Filtrar usuários online (excluir a si mesmo)
  const otherUsers = users.filter(u => u.id !== myUser.id);
  
  if (otherUsers.length === 0) {
    container.innerHTML = '<div style="text-align:center;opacity:0.5;font-size:0.9rem;padding:1rem;">Nenhum usuário online</div>';
    return;
  }
  
  container.innerHTML = otherUsers.map(user => {
    const statusText = user.muted ? 'Mutado' : user.deafened ? 'Ensurdecido' : 'Disponível';
    const statusIcon = user.muted ? '🔇' : user.deafened ? '🔕' : '🎤';
    
    return `
      <div class="online-user-item" data-online-user-id="${user.id}" title="Clique com botão direito para enviar mensagem privada">
        <div class="online-user-avatar">${user.name.charAt(0).toUpperCase()}</div>
        <div class="online-user-info">
          <div class="online-user-name">${escapeHtml(user.name)}</div>
          <div class="online-user-status">${statusIcon} ${statusText}</div>
        </div>
      </div>
    `;
  }).join('');
  
  // Adicionar event listeners para contexto menu
  container.querySelectorAll('.online-user-item').forEach(item => {
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const userId = item.getAttribute('data-online-user-id');
      const userName = item.querySelector('.online-user-name').textContent;
      openOnlineUserMenu(e, userId, userName);
    });
  });
}

function openOnlineUserMenu(e, userId, userName) {
  selectedUserId = userId;
  
  // Criar menu de contexto simples
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  menu.innerHTML = `
    <button class="ctx-item" onclick="openDMWithOnlineUser('${userId}', '${escapeHtml(userName).replaceAll('"', '&quot;')}')">
      💬 Enviar Mensagem Privada
    </button>
  `;
  
  document.body.appendChild(menu);
  
  setTimeout(() => {
    document.addEventListener('click', () => {
      if (menu.parentNode) menu.remove();
    }, { once: true });
  }, 0);
}

function openDMWithOnlineUser(userId, userName) {
  // Inicializar conversa se não existir
  if (!dmConversations[userId]) {
    dmConversations[userId] = [];
  }
  
  // Se não está em sala, mostrar interface de DM standalone
  if (!currentRoom) {
    showDMContainer();
    createOrActivateDMTabStandalone(userId, userName);
  } else {
    // Se está em sala, usar interface normal
    createOrActivateDMTab(userId, userName);
  }
  
  // Mostrar notificação
  showNotification(`💬 Conversando com ${escapeHtml(userName)}`, 'success');
}

function showDMContainer() {
  document.getElementById('no-room-selected').classList.add('hidden');
  document.getElementById('dm-container').classList.remove('hidden');
  document.getElementById('room-container').classList.add('hidden');
}

function closeDMContainer() {
  document.getElementById('dm-container').classList.add('hidden');
  document.getElementById('no-room-selected').classList.remove('hidden');
}

// Event listener para botão voltar
document.getElementById('close-dm-btn').addEventListener('click', () => {
  closeDMContainer();
  currentDMUserId = null;
});

socket.on('user-joined', (data) => {
  showNotification(`${data.user.name} entrou`, 'info');
  addSystemMessage(`${data.user.name} entrou na sala`);
});

socket.on('user-left', (data) => {
  showNotification(`${data.name} saiu`, 'info');
  addSystemMessage(`${data.name} saiu da sala`);
  closePeerConnection(data.userId);
});

socket.on('users-update', (users) => {
  updateUsers(users);
});

socket.on('online-users', (users) => {
  updateOnlineUsers(users);
});

socket.on('user-speaking', (data) => {
  const userEl = document.querySelector(`[data-user-id="${data.userId}"]`);
  if (userEl) {
    userEl.classList.toggle('speaking', data.isSpeaking);
  }
});

// ==================== MENU CONTEXTUAL ====================

function openUserContextMenu(e, userId) {
  e.preventDefault();
  selectedUserId = userId;
  
  const menu = document.getElementById('user-context-menu');
  menu.classList.remove('hidden');
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  
  return false;
}

document.addEventListener('click', () => {
  document.getElementById('user-context-menu').classList.add('hidden');
});

document.getElementById('ctx-kick').addEventListener('click', () => {
  if (!selectedUserId) return;
  if (confirm('Kickar este usuário?')) {
    socket.emit('kick-user', selectedUserId, handleModResponse);
  }
});

document.getElementById('ctx-ban').addEventListener('click', () => {
  if (!selectedUserId) return;
  if (confirm('BANIR este usuário? Ele não poderá voltar!')) {
    socket.emit('ban-user', selectedUserId, handleModResponse);
  }
});

document.getElementById('ctx-promote').addEventListener('click', () => {
  if (!selectedUserId) return;
  socket.emit('promote-moderator', selectedUserId, handleModResponse);
});

document.getElementById('ctx-demote').addEventListener('click', () => {
  if (!selectedUserId) return;
  socket.emit('demote-moderator', selectedUserId, handleModResponse);
});

document.getElementById('ctx-transfer').addEventListener('click', () => {
  if (!selectedUserId) return;
  if (confirm('Transferir a propriedade da sala? Você perderá o controle!')) {
    socket.emit('transfer-ownership', selectedUserId, handleModResponse);
  }
});

// ==================== CHAT PRIVADO (DM) ====================

document.getElementById('ctx-message').addEventListener('click', () => {
  if (!selectedUserId) return;
  openDMWithUser(selectedUserId);
});

function openDMWithUser(userId) {
  console.log('[DEBUG] Abrindo DM com userId:', userId);
  // Encontrar nome do usuário
  const userEl = document.querySelector(`[data-user-id="${userId}"]`);
  if (!userEl) {
    console.warn('[DEBUG] userEl não encontrado para userId:', userId);
    return;
  }
  
  const userName = userEl.querySelector('.name').textContent.trim();
  
  currentDMUserId = userId;
  
  // Inicializar conversa se não existir
  if (!dmConversations[userId]) {
    dmConversations[userId] = [];
  }
  
  // Criar/ativar aba de DM
  createOrActivateDMTab(userId, userName);
}

function createOrActivateDMTab(userId, userName) {
  const dmTabsContainer = document.getElementById('dm-tabs-container');
  let dmTab = document.querySelector(`[data-dm-user="${userId}"]`);
  
  // Se aba não existe, criar
  if (!dmTab) {
    // Criar container da aba
    dmTab = document.createElement('div');
    dmTab.className = 'chat-tab dm-tab';
    dmTab.setAttribute('data-dm-user', userId);
    
    // Criar texto da aba
    const tabText = document.createElement('span');
    tabText.textContent = `💬 ${escapeHtml(userName)}`;
    
    // Criar botão de fechar
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dm-tab-close';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Fechar conversa';
    
    // Montar a aba
    dmTab.appendChild(tabText);
    dmTab.appendChild(closeBtn);
    
    // Evento de clique na aba para ativar
    tabText.addEventListener('click', (e) => {
      e.stopPropagation();
      switchTab(`dm-${userId}`);
    });
    
    // Evento de clique no botão fechar
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Fechar aba
      switchTab('room');
      dmTab.remove();
      if (currentDMUserId === userId) {
        currentDMUserId = null;
      }
      const dmView = document.querySelector(`[data-dm-view="${userId}"]`);
      if (dmView) dmView.remove();
      
      // Remover conversa do objeto dmConversations
      delete dmConversations[userId];
    });
    
    dmTabsContainer.appendChild(dmTab);
    
    // Criar view de DM
    const dmChatsContainer = document.getElementById('dm-chats');
    const dmView = document.createElement('div');
    dmView.className = 'chat-view dm-chat-view';
    dmView.setAttribute('data-dm-view', userId);
    dmView.innerHTML = `
      <div class="dm-messages" data-dm-messages="${userId}"></div>
    `;
    dmChatsContainer.appendChild(dmView);
  } else {
    // Se já existe, apenas ativar
    switchTab(`dm-${userId}`);
  }
  
  // Renderizar histórico
  renderDMMessages(userId);
  
  // Focar no input
  setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

function createOrActivateDMTabStandalone(userId, userName) {
  const dmTabsContainer = document.getElementById('dm-tabs-container-standalone');
  let dmTab = document.querySelector(`[data-dm-user-standalone="${userId}"]`);
  
  // Se aba não existe, criar
  if (!dmTab) {
    // Criar container da aba
    dmTab = document.createElement('div');
    dmTab.className = 'chat-tab dm-tab';
    dmTab.setAttribute('data-dm-user-standalone', userId);
    
    // Criar texto da aba
    const tabText = document.createElement('span');
    tabText.textContent = `💬 ${escapeHtml(userName)}`;
    
    // Criar botão de fechar
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dm-tab-close';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Fechar conversa';
    
    // Montar a aba
    dmTab.appendChild(tabText);
    dmTab.appendChild(closeBtn);
    
    // Evento de clique na aba para ativar
    tabText.addEventListener('click', (e) => {
      e.stopPropagation();
      switchTabStandalone(`dm-${userId}`);
    });
    
    // Evento de clique no botão fechar
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      // Fechar aba
      dmTab.remove();
      if (currentDMUserId === userId) {
        currentDMUserId = null;
      }
      const dmView = document.querySelector(`[data-dm-view-standalone="${userId}"]`);
      if (dmView) dmView.remove();
      
      // Se não há mais abas, voltar
      if (dmTabsContainer.children.length === 0) {
        closeDMContainer();
      }
      
      // Remover conversa do objeto dmConversations
      delete dmConversations[userId];
    });
    
    dmTabsContainer.appendChild(dmTab);
    
    // Criar view de DM
    const dmChatsContainer = document.getElementById('dm-chats-standalone');
    const dmView = document.createElement('div');
    dmView.className = 'chat-view dm-chat-view';
    dmView.setAttribute('data-dm-view-standalone', userId);
    dmView.innerHTML = `
      <div class="dm-messages" data-dm-messages="${userId}"></div>
    `;
    dmChatsContainer.appendChild(dmView);
    
    // Ativar a aba recém-criada
    switchTabStandalone(`dm-${userId}`);
  } else {
    // Se já existe, apenas ativar
    switchTabStandalone(`dm-${userId}`);
  }
  
  // Renderizar histórico
  renderDMMessages(userId);
  
  // Focar no input
  setTimeout(() => document.getElementById('chat-input-dm').focus(), 100);
}

function switchTabStandalone(tabName) {
  // Remover classe active de todas as abas
  document.querySelectorAll('[data-dm-user-standalone]').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Remover classe active de todas as views
  document.querySelectorAll('[data-dm-view-standalone]').forEach(view => {
    view.classList.remove('active');
  });
  
  // Ativar aba selecionada
  const userId = tabName.replace('dm-', '');
  const dmTab = document.querySelector(`[data-dm-user-standalone="${userId}"]`);
  const dmView = document.querySelector(`[data-dm-view-standalone="${userId}"]`);
  
  if (dmTab) dmTab.classList.add('active');
  if (dmView) dmView.classList.add('active');
  
  currentDMUserId = userId;
}

function switchTab(tabName) {
  // Remover classe active de todas as abas
  document.querySelectorAll('.chat-tab').forEach(tab => {
    tab.classList.remove('active');
    tab.classList.remove('new-message'); // Remover indicador de mensagem nova
  });
  
  // Remover classe active de todas as views
  document.querySelectorAll('.chat-view').forEach(view => {
    view.classList.remove('active');
  });
  
  // Ativar aba selecionada
  if (tabName === 'room') {
    document.getElementById('tab-room').classList.add('active');
    document.getElementById('room-chat').classList.add('active');
    currentDMUserId = null;
    document.getElementById('chat-input').placeholder = 'Mensagem criptografada...';
  } else {
    // Tab de DM
    const userId = tabName.replace('dm-', '');
    const dmTab = document.querySelector(`[data-dm-user="${userId}"]`);
    const dmView = document.querySelector(`[data-dm-view="${userId}"]`);
    
    if (dmTab) dmTab.classList.add('active');
    if (dmView) dmView.classList.add('active');
    
    currentDMUserId = userId;
    document.getElementById('chat-input').placeholder = 'Mensagem privada...';
  }
}

function renderDMMessages(userId) {
  const container = document.querySelector(`[data-dm-messages="${userId}"]`);
  if (!container) return;
  
  container.innerHTML = '';
  
  const messages = dmConversations[userId] || [];
  
  if (messages.length === 0) {
    container.innerHTML = '<div style="text-align:center;opacity:0.5;margin-top:2rem;">Nenhuma mensagem ainda</div>';
    return;
  }
  
  messages.forEach(msg => {
    const msgEl = document.createElement('div');
    msgEl.className = `dm-message ${msg.isOwn ? 'own' : 'other'}`;
    
    const timestamp = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    msgEl.innerHTML = `
      <div class="dm-message-content">${escapeHtml(msg.text)}</div>
      <div class="dm-message-time">${timestamp}</div>
    `;
    
    container.appendChild(msgEl);
  });
  
  container.scrollTop = container.scrollHeight;
}

// ==================== ENVIO DE MENSAGEM (Sala ou DM) ====================

// Mapa para armazenar chaves públicas de outros usuários
let userPublicKeys = {};

// Listener para receber chaves públicas dos usuários online
socket.on('public-key-shared', (data) => {
  userPublicKeys[data.userId] = data.publicKey;
  console.log(`🔑 Chave pública recebida de ${data.userId}`);
});

const originalChatFormListener = document.getElementById('chat-form');
originalChatFormListener.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  
  if (!message) return;
  
  // Se está em DM
  if (currentDMUserId) {
    // Adicionar à conversa local
    if (!dmConversations[currentDMUserId]) {
      dmConversations[currentDMUserId] = [];
    }
    
    dmConversations[currentDMUserId].push({
      text: message,
      isOwn: true,
      timestamp: Date.now()
    });
    
    // Criptografar mensagem se encryption estiver ativado
    let encryptedData = message;
    if (window.encryptionManager.isEncryptionEnabled() && userPublicKeys[currentDMUserId]) {
      encryptedData = window.encryptionManager.encryptMessage(message, userPublicKeys[currentDMUserId]);
    }
    
    // Enviar para servidor
    socket.emit('private-message', {
      recipientId: currentDMUserId,
      message: encryptedData,
      encrypted: typeof encryptedData === 'object'
    });
    
    // Renderizar
    renderDMMessages(currentDMUserId);
  } else {
    // Enviar para sala
    socket.emit('chat-message', message);
  }
  
  input.value = '';
});

// Listener para formulário de DM standalone
const dmFormStandalone = document.getElementById('chat-form-dm');
dmFormStandalone.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const input = document.getElementById('chat-input-dm');
  const message = input.value.trim();
  
  if (!message || !currentDMUserId) return;
  
  // Adicionar à conversa local
  if (!dmConversations[currentDMUserId]) {
    dmConversations[currentDMUserId] = [];
  }
  
  dmConversations[currentDMUserId].push({
    text: message,
    isOwn: true,
    timestamp: Date.now()
  });
  
  // Criptografar mensagem se encryption estiver ativado
  let encryptedData = message;
  if (window.encryptionManager.isEncryptionEnabled() && userPublicKeys[currentDMUserId]) {
    encryptedData = window.encryptionManager.encryptMessage(message, userPublicKeys[currentDMUserId]);
  }
  
  // Enviar para servidor
  socket.emit('private-message', {
    recipientId: currentDMUserId,
    message: encryptedData,
    encrypted: typeof encryptedData === 'object'
  });
  
  // Renderizar
  renderDMMessages(currentDMUserId);
  
  input.value = '';
});

// Receber mensagem privada
socket.on('private-message', (data) => {
  if (!dmConversations[data.senderId]) {
    dmConversations[data.senderId] = [];
  }
  
  // Descriptografar se a mensagem foi criptografada
  let messageText = data.message;
  if (data.encrypted && window.encryptionManager.isEncryptionEnabled()) {
    messageText = window.encryptionManager.decryptMessage(data.message);
  }
  
  dmConversations[data.senderId].push({
    text: messageText,
    isOwn: false,
    timestamp: Date.now()
  });
  
  // Tocar som de notificação
  playNotificationSound();
  
  // Se o DM está aberto, atualizar
  if (currentDMUserId === data.senderId) {
    renderDMMessages(data.senderId);
  } else {
    // Se está na tela inicial (sem sala), mostrar interface standalone
    if (!currentRoom) {
      showDMContainer();
      createOrActivateDMTabStandalone(data.senderId, data.senderName);
      
      // Mostrar notificação
      showNotification(`💬 Nova DM de ${escapeHtml(data.senderName)}: ${escapeHtml(messageText.substring(0, 40))}`, 'info');
    } else {
      // Se está em sala, usar interface normal
      const dmTabsContainer = document.getElementById('dm-tabs-container');
      let dmTab = document.querySelector(`[data-dm-user="${data.senderId}"]`);
      
      // Se aba não existe, criar
      if (!dmTab) {
        // Usar a função para criar a aba corretamente
        createOrActivateDMTab(data.senderId, data.senderName);
      }
      
      // Renderizar histórico
      renderDMMessages(data.senderId);
      
      // Notificar com badge visual
      if (dmTab) {
        // Adicionar indicador de mensagem nova
        dmTab.classList.add('new-message');
        dmTab.setAttribute('title', `${data.senderName}: ${messageText.substring(0, 30)}...`);
      }
      
      // Mostrar notificação também
      showNotification(`💬 Nova DM de ${escapeHtml(data.senderName)}: ${escapeHtml(messageText.substring(0, 40))}`, 'info');
    }
  }
});

function handleModResponse(response) {
  if (response.success) {
    showNotification('Ação realizada', 'success');
  } else {
    showNotification(response.error || 'Erro', 'error');
  }
}

socket.on('kicked', (data) => {
  showNotification(`Você foi kickado de ${data.roomName}`, 'warning');
  resetRoomUI();
});

socket.on('banned', (data) => {
  showNotification(`Você foi BANIDO de ${data.roomName}`, 'error');
  resetRoomUI();
});

// ==================== CHAT ====================

socket.on('chat-message', (data) => {
  if (!currentRoom) return;
  
  // Tocar som de notificação (apenas para mensagens de outros usuários)
  if (data.userId !== myUser.id) {
    playNotificationSound();
  }
  
  const container = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = `msg ${data.userId === myUser.id ? 'own' : ''}`;
  
  const timestamp = new Date(data.timestamp || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const content = processMessageContent(data.message);
  
  msg.innerHTML = `
    <div class="msg-header">
      <strong>${escapeHtml(data.name)}</strong>
      <span class="msg-time">${timestamp}</span>
    </div>
    <div class="msg-content">${content}</div>
  `;
  
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
});

function addSystemMessage(text) {
  const container = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.style.textAlign = 'center';
  msg.style.opacity = '0.6';
  msg.style.fontSize = '0.9rem';
  msg.textContent = text;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// ==================== CONTROLES DE ÁUDIO ====================

document.getElementById('mute-btn').addEventListener('click', () => {
  if (!localStream) {
    showNotification('Microfone não disponível', 'error');
    return;
  }
  
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  
  isMuted = !isMuted;
  track.enabled = !isMuted;
  
  const btn = document.getElementById('mute-btn');
  btn.classList.toggle('active', !isMuted);
  btn.textContent = isMuted ? '🔇' : '🎤';
  
  socket.emit('audio-status', { muted: isMuted });
  showNotification(isMuted ? 'Microfone desativado' : 'Microfone ativado', 'info');
});

document.getElementById('deafen-btn').addEventListener('click', () => {
  isDeafened = !isDeafened;
  
  // Mutar/desmutar todos os áudios
  const audioElements = document.querySelectorAll('audio');
  audioElements.forEach(audio => {
    audio.muted = isDeafened;
  });
  
  // Se ensurdeceu, mutar o microfone automaticamente (como no Discord)
  if (isDeafened && !isMuted) {
    isMuted = true;
    if (localStream) {
      const tracks = localStream.getAudioTracks();
      tracks.forEach(track => {
        track.enabled = false;
      });
    }
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.classList.toggle('active', true);
    muteBtn.textContent = '🔇';
    socket.emit('audio-status', { muted: true });
    showNotification('Microfone desativado automaticamente', 'info');
  }
  // Se desensurdeceu e o microfone estava mutado por ensurdecimento, desmutar automaticamente
  else if (!isDeafened && isMuted) {
    isMuted = false;
    if (localStream) {
      const tracks = localStream.getAudioTracks();
      tracks.forEach(track => {
        track.enabled = true;
      });
    }
    const muteBtn = document.getElementById('mute-btn');
    muteBtn.classList.toggle('active', false);
    muteBtn.textContent = '🎤';
    socket.emit('audio-status', { muted: false });
    showNotification('Microfone ativado automaticamente', 'info');
  }
  
  const btn = document.getElementById('deafen-btn');
  btn.classList.toggle('active', isDeafened);
  btn.textContent = isDeafened ? '🔕' : '🔊';
  
  showNotification(isDeafened ? 'Som desativado' : 'Som ativado', 'info');
});

// Speaking detection
function startSpeakingDetection() {
  if (speakingInterval) clearInterval(speakingInterval);
  if (!localStream) return;
  
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(localStream);
  source.connect(analyser);
  analyser.fftSize = 256;
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  speakingInterval = setInterval(() => {
    analyser.getByteFrequencyData(dataArray);
    const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const isSpeaking = volume > 20;
    
    socket.emit('speaking', isSpeaking);
    
    const myUserEl = document.querySelector(`[data-user-id="${myUser.id}"]`);
    if (myUserEl) myUserEl.classList.toggle('speaking', isSpeaking);
  }, 100);
}

function stopSpeakingDetection() {
  if (speakingInterval) {
    clearInterval(speakingInterval);
    speakingInterval = null;
  }
}

// ==================== WEBRTC P2P ====================

function connectToAllPeers(users) {
  users.forEach(user => {
    if (user.id !== myUser.id) {
      createPeerConnection(user.id, true);
    }
  });
}

function createPeerConnection(userId, isInitiator = false) {
  if (peers[userId]) return;
  
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  
  peers[userId] = pc;
  
  // Adicionar stream local
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }
  
  // Receber stream remoto
  pc.ontrack = (event) => {
    console.log('🎵 Stream remoto de:', userId);
    playRemoteStream(userId, event.streams[0]);
  };
  
  // ICE candidate
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetId: userId,
        candidate: event.candidate
      });
    }
  };
  
  // Se for iniciador, criar offer
  if (isInitiator) {
    pc.createOffer()
      .then(offer => pc.setLocalDescription(offer))
      .then(() => {
        socket.emit('webrtc-offer', {
          targetId: userId,
          offer: pc.localDescription
        });
      })
      .catch(err => console.error('Erro offer:', err));
  }
}

socket.on('webrtc-offer', async (data) => {
  let pc = peers[data.senderId];
  
  if (!pc) {
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    peers[data.senderId] = pc;
    
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }
    
    pc.ontrack = (event) => {
      playRemoteStream(data.senderId, event.streams[0]);
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          targetId: data.senderId,
          candidate: event.candidate
        });
      }
    };
  }
  
  await pc.setRemoteDescription(data.offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit('webrtc-answer', {
    targetId: data.senderId,
    answer: pc.localDescription
  });
});

socket.on('webrtc-answer', (data) => {
  const pc = peers[data.senderId];
  if (pc) {
    pc.setRemoteDescription(data.answer);
  }
});

socket.on('webrtc-ice-candidate', (data) => {
  const pc = peers[data.senderId];
  if (pc && data.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

function playRemoteStream(userId, stream) {
  let audio = document.getElementById(`audio-${userId}`);
  
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = `audio-${userId}`;
    audio.autoplay = true;
    document.body.appendChild(audio);
  }
  
  audio.srcObject = stream;
}

function closePeerConnection(userId) {
  if (peers[userId]) {
    peers[userId].close();
    delete peers[userId];
  }
  
  const audio = document.getElementById(`audio-${userId}`);
  if (audio) audio.remove();
}

function closeAllPeerConnections() {
  Object.keys(peers).forEach(userId => {
    closePeerConnection(userId);
  });
  peers = {};
}

// ==================== CRIAR SALA ====================

document.getElementById('create-room-btn').addEventListener('click', () => {
  document.getElementById('create-modal').classList.remove('hidden');
});

document.getElementById('cancel-create').addEventListener('click', () => {
  document.getElementById('create-modal').classList.add('hidden');
});

document.getElementById('create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const name = document.getElementById('new-room-name').value.trim();
  let password = document.getElementById('new-room-password').value;
  const maxUsers = parseInt(document.getElementById('new-room-max').value);
  
  if (!name) {
    showNotification('Digite um nome para a sala', 'error');
    return;
  }
  
  // Converter string vazia para null
  password = password.trim() || null;
  
  socket.emit('create-room', { name, password, maxUsers }, (response) => {
    if (response.success) {
      document.getElementById('create-modal').classList.add('hidden');
      document.getElementById('create-form').reset();
      showNotification(`Sala "${name}" criada!`, 'success');
      
      // Armazenar senha se tiver, para usar ao entrar
      currentRoomPassword = password;
      
      // Entrar na sala (passar a senha se houver)
      joinRoom(response.room.id, password);
    } else {
      showNotification(response.error || 'Erro ao criar sala', 'error');
    }
  });
});

// ==================== CONVITE ====================

document.getElementById('invite-btn').addEventListener('click', () => {
  if (!currentRoom) return;
  
  const code = currentRoom.code;
  const link = `${window.location.origin}/join/${code}`;
  
  document.getElementById('invite-code-display').value = code;
  document.getElementById('invite-link-display').value = link;
  document.getElementById('invite-modal').classList.remove('hidden');
});

document.getElementById('close-invite').addEventListener('click', () => {
  document.getElementById('invite-modal').classList.add('hidden');
});

document.getElementById('copy-code-btn').addEventListener('click', () => {
  copyToClipboard(document.getElementById('invite-code-display').value);
  showNotification('Código copiado!', 'success');
});

document.getElementById('copy-link-btn').addEventListener('click', () => {
  copyToClipboard(document.getElementById('invite-link-display').value);
  showNotification('Link copiado!', 'success');
});

// ==================== UTILIDADES ====================

function showNotification(message, type = 'info') {
  const container = document.getElementById('notifications');
  const notif = document.createElement('div');
  notif.className = `notification ${type}`;
  notif.textContent = message;
  container.appendChild(notif);
  
  setTimeout(() => notif.remove(), 4000);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Função para tocar notificação sonora
function playNotificationSound() {
  if (!enableSoundNotifications) return;
  
  try {
    // Usar arquivo de som OGG
    const audio = new Audio('/sounds/notification.ogg');
    audio.volume = 0.5; // Volume moderado
    audio.play().catch(err => {
      console.warn('⚠️ Não foi possível tocar som:', err);
      // Fallback: usar tom Web Audio API
      playFallbackSound();
    });
  } catch (err) {
    console.warn('⚠️ Erro ao criar áudio:', err);
    playFallbackSound();
  }
}

// Fallback: tom usando Web Audio API
function playFallbackSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Tom agradável: 800Hz por 150ms
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.value = 800;
    osc.type = 'sine';
    
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (err) {
    console.warn('⚠️ Fallback de som também falhou:', err);
  }
}

// Fechar modais clicando fora
document.querySelectorAll('.modal').forEach(modal => {
  modal.querySelector('.modal-overlay')?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });
});

// ==================== BOTÕES SIDEBAR ====================

// Status Button
document.getElementById('status-btn')?.addEventListener('click', (e) => {
  const menu = document.getElementById('status-menu');
  menu.classList.toggle('hidden');
  e.stopPropagation();
});

// Status menu items
document.querySelectorAll('#status-menu button').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const status = btn.dataset.status;
    updateUserStatus(status);
    document.getElementById('status-menu').classList.add('hidden');
  });
});

// Close status menu when clicking outside
document.addEventListener('click', () => {
  document.getElementById('status-menu')?.classList.add('hidden');
});

function updateUserStatus(status) {
  const statusText = {
    online: '🟢 Online',
    busy: '🔴 Ocupado',
    away: '🟡 Ausente',
    dnd: '⛔ Não Perturbe'
  };
  
  document.getElementById('status-text').textContent = statusText[status];
  document.getElementById('status-indicator').textContent = status === 'online' ? '🟢' : 
                                                           status === 'busy' ? '🔴' :
                                                           status === 'away' ? '🟡' : '⛔';
}

// Settings button - abrir modal de configurações
document.getElementById('settings-btn')?.addEventListener('click', () => {
  const settingsModal = document.getElementById('audio-settings-modal');
  if (settingsModal) {
    settingsModal.classList.remove('hidden');
    loadAudioDevices();
    startMicTest();
  }
});

// Close settings modal
document.getElementById('close-audio-settings')?.addEventListener('click', () => {
  const settingsModal = document.getElementById('audio-settings-modal');
  if (settingsModal) {
    settingsModal.classList.add('hidden');
    stopMicTest();
  }
});

// Close settings modal when clicking overlay
document.querySelector('#audio-settings-modal .modal-overlay')?.addEventListener('click', () => {
  const settingsModal = document.getElementById('audio-settings-modal');
  if (settingsModal) {
    settingsModal.classList.add('hidden');
    stopMicTest();
  }
});

// Settings form handlers
document.getElementById('audio-input-select')?.addEventListener('change', (e) => {
  if (audioContext && localStream) {
    const deviceId = e.target.value;
    if (deviceId) {
      localStorage.setItem('preferredAudioInput', deviceId);
      showNotification('Dispositivo de entrada alterado', 'success');
    }
  }
});

document.getElementById('audio-output-select')?.addEventListener('change', (e) => {
  const deviceId = e.target.value;
  if (deviceId) {
    localStorage.setItem('preferredAudioOutput', deviceId);
    showNotification('Dispositivo de saída alterado', 'success');
  }
});

document.getElementById('mic-volume')?.addEventListener('input', (e) => {
  const volume = parseInt(e.target.value) / 100;
  document.getElementById('mic-volume-value').textContent = e.target.value + '%';
  
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      if (track.enabled && audioContext) {
        const gainNode = audioContext.createGain();
        gainNode.gain.value = volume;
      }
    });
  }
  localStorage.setItem('micVolume', e.target.value);
});

document.getElementById('output-volume')?.addEventListener('input', (e) => {
  const volume = parseInt(e.target.value) / 100;
  document.getElementById('output-volume-value').textContent = e.target.value + '%';
  
  document.querySelectorAll('audio').forEach(audio => {
    audio.volume = volume;
  });
  
  localStorage.setItem('outputVolume', e.target.value);
});

document.getElementById('noise-suppression')?.addEventListener('change', (e) => {
  localStorage.setItem('noiseSuppression', e.target.checked);
  showNotification(e.target.checked ? 'Supressão de ruído ativada' : 'Supressão de ruído desativada', 'success');
});

document.getElementById('echo-cancellation')?.addEventListener('change', (e) => {
  localStorage.setItem('echoCancellation', e.target.checked);
  showNotification(e.target.checked ? 'Cancelamento de eco ativado' : 'Cancelamento de eco desativado', 'success');
});

document.getElementById('auto-gain')?.addEventListener('change', (e) => {
  localStorage.setItem('autoGain', e.target.checked);
  showNotification(e.target.checked ? 'Ganho automático ativado' : 'Ganho automático desativado', 'success');
});

document.getElementById('audio-quality')?.addEventListener('change', (e) => {
  localStorage.setItem('audioQuality', e.target.value);
  showNotification(`Qualidade de áudio alterada para: ${e.target.options[e.target.selectedIndex].text}`, 'success');
});

document.getElementById('sound-notifications')?.addEventListener('change', (e) => {
  enableSoundNotifications = e.target.checked;
  localStorage.setItem('enableSoundNotifications', e.target.checked);
  showNotification(e.target.checked ? '🔔 Som de notificação ativado' : '🔔 Som de notificação desativado', 'success');
  
  // Tocar som de teste se ativado
  if (e.target.checked) {
    playNotificationSound();
  }
});

// Mic test
let micTestAnalyser = null;
let micTestAnimationId = null;

function startMicTest() {
  if (!localStream) {
    console.warn('⚠️ Microfone não está ativo');
    return;
  }
  
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) {
    console.warn('⚠️ Nenhuma faixa de áudio encontrada');
    return;
  }
  
  try {
    // Criar AudioContext se não existir
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Se AudioContext estava suspenso, retomar
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    const source = audioContext.createMediaStreamSource(localStream);
    micTestAnalyser = audioContext.createAnalyser();
    micTestAnalyser.fftSize = 256;
    source.connect(micTestAnalyser);
    
    const dataArray = new Uint8Array(micTestAnalyser.frequencyBinCount);
    const micLevelBar = document.getElementById('mic-level');
    
    if (!micLevelBar) {
      console.warn('⚠️ Elemento mic-level não encontrado');
      return;
    }
    
    function updateMicLevel() {
      if (micTestAnalyser) {
        micTestAnalyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const level = Math.min(100, (average / 255) * 150); // Aumentado sensibilidade
        
        micLevelBar.style.width = level + '%';
        micTestAnimationId = requestAnimationFrame(updateMicLevel);
      }
    }
    
    updateMicLevel();
    console.log('✅ Teste de microfone iniciado');
  } catch (error) {
    console.error('❌ Erro ao iniciar teste de microfone:', error);
  }
}

function stopMicTest() {
  if (micTestAnimationId) {
    cancelAnimationFrame(micTestAnimationId);
    micTestAnimationId = null;
  }
  micTestAnalyser = null;
  
  const micLevelBar = document.getElementById('mic-level');
  if (micLevelBar) {
    micLevelBar.style.width = '0%';
  }
  console.log('✅ Teste de microfone parado');
}

// Stats button - abrir modal de estatísticas
document.getElementById('stats-btn')?.addEventListener('click', () => {
  const statsModal = document.getElementById('stats-modal');
  if (statsModal) {
    statsModal.classList.remove('hidden');
    loadServerStats();
  }
});

// Close stats modal
document.querySelector('#stats-modal .modal-overlay')?.addEventListener('click', () => {
  const statsModal = document.getElementById('stats-modal');
  if (statsModal) {
    statsModal.classList.add('hidden');
  }
});

// Refresh stats button
document.getElementById('refresh-stats')?.addEventListener('click', () => {
  loadServerStats();
  showNotification('Estatísticas atualizadas', 'success');
});

// Close stats button
document.getElementById('close-stats')?.addEventListener('click', () => {
  const statsModal = document.getElementById('stats-modal');
  if (statsModal) {
    statsModal.classList.add('hidden');
  }
});

// Load server statistics
function loadServerStats() {
  socket.emit('get-server-stats', (stats) => {
    if (stats) {
      document.getElementById('stat-current-users').textContent = stats.currentUsers || 0;
      document.getElementById('stat-total-rooms').textContent = stats.totalRooms || 0;
      document.getElementById('stat-total-connections').textContent = stats.totalConnections || 0;
      document.getElementById('stat-peak-users').textContent = stats.peakUsers || 0;
      document.getElementById('stat-uptime').textContent = formatUptime(stats.uptime || 0);
      document.getElementById('stat-total-messages').textContent = '0'; // Pode ser implementado depois
    }
  });
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Load audio devices
async function loadAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
    
    const inputSelect = document.getElementById('audio-input-select');
    if (inputSelect) {
      inputSelect.innerHTML = audioInputs.map(device => 
        `<option value="${device.deviceId}">${device.label || 'Microfone ' + device.deviceId.slice(0, 8)}</option>`
      ).join('');
      
      const preferred = localStorage.getItem('preferredAudioInput');
      if (preferred) {
        inputSelect.value = preferred;
      }
    }
    
    const outputSelect = document.getElementById('audio-output-select');
    if (outputSelect) {
      outputSelect.innerHTML = audioOutputs.map(device => 
        `<option value="${device.deviceId}">${device.label || 'Alto-falante ' + device.deviceId.slice(0, 8)}</option>`
      ).join('');
      
      const preferred = localStorage.getItem('preferredAudioOutput');
      if (preferred) {
        outputSelect.value = preferred;
      }
    }
  } catch (error) {
    console.error('Erro ao carregar dispositivos de áudio:', error);
    showNotification('Erro ao carregar dispositivos de áudio', 'error');
  }
}

// Restore saved audio settings on startup
function restoreAudioSettings() {
  const micVolume = localStorage.getItem('micVolume') || 100;
  const outputVolume = localStorage.getItem('outputVolume') || 100;
  const noiseSuppression = localStorage.getItem('noiseSuppression') === 'true';
  const echoCancellation = localStorage.getItem('echoCancellation') !== 'false';
  const autoGain = localStorage.getItem('autoGain') === 'true';
  const audioQuality = localStorage.getItem('audioQuality') || 'medium';
  const soundNotifications = localStorage.getItem('enableSoundNotifications') !== 'false'; // true por padrão
  
  const micVolumeInput = document.getElementById('mic-volume');
  if (micVolumeInput) {
    micVolumeInput.value = micVolume;
    document.getElementById('mic-volume-value').textContent = micVolume + '%';
  }
  
  const outputVolumeInput = document.getElementById('output-volume');
  if (outputVolumeInput) {
    outputVolumeInput.value = outputVolume;
    document.getElementById('output-volume-value').textContent = outputVolume + '%';
  }
  
  const noiseSuppressionCheckbox = document.getElementById('noise-suppression');
  if (noiseSuppressionCheckbox) {
    noiseSuppressionCheckbox.checked = noiseSuppression;
  }
  
  const echoCancellationCheckbox = document.getElementById('echo-cancellation');
  if (echoCancellationCheckbox) {
    echoCancellationCheckbox.checked = echoCancellation;
  }
  
  const autoGainCheckbox = document.getElementById('auto-gain');
  if (autoGainCheckbox) {
    autoGainCheckbox.checked = autoGain;
  }
  
  const audioQualitySelect = document.getElementById('audio-quality');
  if (audioQualitySelect) {
    audioQualitySelect.value = audioQuality;
  }
  
  const soundNotificationsCheckbox = document.getElementById('sound-notifications');
  if (soundNotificationsCheckbox) {
    soundNotificationsCheckbox.checked = soundNotifications;
    enableSoundNotifications = soundNotifications;
  }
}

// ==================== PROCESSAMENTO DE MENSAGENS ====================

// Detectar e processar URLs, emojis e formatação
function processMessageContent(text) {
  let processed = escapeHtml(text);
  
  // Converter URLs em links
  processed = processed.replace(
    /https?:\/\/[^\s<>"\)]+/g,
    match => `<a href="${match}" target="_blank" rel="noopener" class="msg-link">🔗 ${new URL(match).hostname}</a>`
  );
  
  // Detectar emojis simples (textos com :)
  const emojiMap = {
    ':)': '😊', ':(': '😢', ':D': '😄', ':P': '😜', ':O': '😮',
    ':heart:': '❤️', ':+1:': '👍', ':-1:': '👎', ':fire:': '🔥',
    ':tada:': '🎉', ':laugh:': '😂', ':thinking:': '🤔', ':wink:': '😉'
  };
  
  Object.entries(emojiMap).forEach(([text, emoji]) => {
    processed = processed.replaceAll(text, emoji);
  });
  
  // Quebras de linha
  processed = processed.replace(/\n/g, '<br>');
  
  return processed;
}

// Reconhecer e renderizar mídia (imagens, vídeos)
function processMediaMessage(url) {
  const urlLower = url.toLowerCase();
  
  // Tipos de arquivo suportados
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(urlLower)) {
    return `<img src="${url}" class="msg-media msg-image" alt="Imagem" style="max-width: 300px; border-radius: 8px; margin-top: 8px;">`;
  }
  
  if (/\.(mp4|webm|mov)$/i.test(urlLower)) {
    return `<video controls class="msg-media msg-video" style="max-width: 300px; border-radius: 8px; margin-top: 8px;">
      <source src="${url}" type="video/mp4">
      Seu navegador não suporta vídeos.
    </video>`;
  }
  
  if (/\.(mp3|wav|ogg)$/i.test(urlLower)) {
    return `<audio controls class="msg-media msg-audio" style="margin-top: 8px;">
      <source src="${url}" type="audio/mpeg">
      Seu navegador não suporta áudio.
    </audio>`;
  }
  
  return null;
}
