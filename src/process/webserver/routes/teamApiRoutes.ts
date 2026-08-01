import type { Express, Request, Response, RequestHandler } from 'express';
import { SqliteTeamRepository } from '@process/team/repository/SqliteTeamRepository';
import { getTeamSessionService } from '@process/bridge/teamBridge';


export function registerTeamApiRoutes(app: Express, _validateApiAccess: RequestHandler): void {
  const teamRepo = new SqliteTeamRepository();

  /**
   * POST /api/teams/create
   * Permite crear un equipo en Wayland mediante llamada HTTP/CLI
   */
  app.post('/api/teams/create', async (req: Request, res: Response) => {
    try {
      const { name, workspace, agents, sessionMode } = req.body;

      if (!name || !Array.isArray(agents)) {
        res.status(400).json({ error: 'name and agents array are required' });
        return;
      }

      const formattedAgents = agents.map((a: any, idx: number) => ({
        slotId: a.slotId || `slot_${idx}_${Date.now()}`,
        conversationId: a.conversationId || '',
        role: a.role || (idx === 0 ? 'leader' : 'teammate'),
        agentType: a.agentType || a.cli || 'hermes',
        agentName: a.agentName || a.name || `Agent ${idx + 1}`,
        conversationType: a.conversationType || 'chat',
        status: 'pending' as const,
        customAgentId: a.preset || a.customAgentId || undefined,
        model: a.model || undefined,
      }));

      const teamSessionService = getTeamSessionService();
      let teamRecord;

      if (teamSessionService) {
        teamRecord = await teamSessionService.createTeam({
          userId: 'system_default_user',
          name,
          workspace: workspace || '',
          workspaceMode: 'shared',
          agents: formattedAgents,
          sessionMode: sessionMode || 'yolo',
        });
      } else {
        const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const leaderAgentId = formattedAgents.find((a) => a.role === 'leader')?.slotId || formattedAgents[0].slotId;

        teamRecord = {
          id: teamId,
          userId: 'system_default_user',
          name,
          workspace: workspace || '',
          workspaceMode: 'shared' as const,
          leaderAgentId,
          agents: formattedAgents,
          sessionMode: sessionMode || 'yolo',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await teamRepo.create(teamRecord as any);
      }

      res.json({
        success: true,
        teamId: teamRecord.id,
        url: `http://localhost:25809/#/team/${teamRecord.id}`,
        team: teamRecord,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: errorMsg });
    }
  });

  /**
   * GET /api/teams/list
   * Lista todos los equipos activos registrados en SQLite
   */
  app.get('/api/teams/list', async (_req: Request, res: Response) => {
    try {
      const teams = await teamRepo.findAll('system_default_user');
      res.json({ teams });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: errorMsg });
    }
  });

  /**
   * GET /api/agents/list
   * Surfaces available execution engines and preset profiles for voice & CLI
   */
  app.get('/api/agents/list', async (_req: Request, res: Response) => {
    try {
      const { agentRegistry } = await import('@process/agent/AgentRegistry');
      const agents = agentRegistry.getDetectedAgents();
      res.json({
        ok: true,
        agents: agents.map((a) => ({
          backend: a.backend,
          name: a.name,
          kind: a.kind,
        })),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: errorMsg });
    }
  });

  /**
   * POST /api/chat/prompt
   * Endpoint de voz / chat HTTP directo para enviar prompts a perfiles de Wayland
   */
  app.post('/api/chat/prompt', async (req: Request, res: Response) => {
    try {
      const { prompt, profile } = req.body;
      if (!prompt) {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      if (typeof (global as any).broadcastVoiceEvent === 'function') {
        (global as any).broadcastVoiceEvent({
          type: 'state',
          state: 'thinking',
          profile: profile || 'secretaria',
        });
      }

      const targetBackend = profile ? (profile.startsWith('hermes-') ? profile : `hermes-${profile}`) : 'hermes-secretaria';

      const { workerTaskManager } = await import('@process/task/workerTaskManagerSingleton');
      const { SqliteConversationRepository } = await import('@process/services/database/SqliteConversationRepository');
      const repo = new SqliteConversationRepository();

      const reqConvId = req.body.conversationId || req.body.conversation_id;
      let activeConv: any = null;

      const shouldReset = req.body.reset === true || req.body.reset === 'true';
      if (shouldReset) {
        const { conversationServiceSingleton } = await import('@process/services/conversationServiceSingleton');
        activeConv = await conversationServiceSingleton.createConversation({
          type: 'acp',
          model: { useModel: 'default' } as any,
          extra: {
            backend: targetBackend,
            agentType: targetBackend,
            workspace: '',
            sessionMode: 'yolo',
          },
        });
      } else if (reqConvId) {
        activeConv = await repo.getConversation(reqConvId);
      }

      if (!activeConv) {
        const { conversationServiceSingleton } = await import('@process/services/conversationServiceSingleton');
        activeConv = await conversationServiceSingleton.createConversation({
          type: 'acp',
          model: { useModel: 'default' } as any,
          extra: {
            backend: targetBackend,
            agentType: targetBackend,
            workspace: '',
            sessionMode: 'yolo',
          },
        });
      }

      const { uuid } = await import('@/common/utils');
      const msgId = uuid();

      const task = await workerTaskManager.getOrBuildTask(activeConv.id);
      let fullResponseText = '';

      const startTime = Date.now();
      const handleEvent = (event: any) => {
        const convId = event.conversation_id || event.conversationId || event.data?.conversation_id;
        if (!convId || convId === activeConv.id) {
          if (event.type === 'content' && typeof event.data === 'string') {
            fullResponseText += event.data;
          } else if (event.type === 'text' && typeof event.data === 'string') {
            fullResponseText += event.data;
          } else if (event.type === 'text' && event.data?.content) {
            fullResponseText += typeof event.data.content === 'string' ? event.data.content : (event.data.content?.text || '');
          } else if (typeof event.data?.text === 'string') {
            fullResponseText += event.data.text;
          } else if (typeof event.data?.delta === 'string') {
            fullResponseText += event.data.delta;
          } else if (typeof event.data === 'string' && event.type !== 'agent_status' && event.type !== 'request_trace') {
            fullResponseText += event.data;
          }
        }
      };

      const { channelEventBus } = await import('@process/channels/agent/ChannelEventBus');
      let isFinished = false;

      const unsub3 = channelEventBus.onAgentMessage((msg: any) => {
        if (msg.conversation_id === activeConv.id) {
          if (msg.type === 'content' && typeof msg.data === 'string') {
            fullResponseText += msg.data;
          } else if (msg.type === 'text' && typeof msg.content?.content === 'string') {
            fullResponseText += msg.content.content;
          } else if (typeof msg.content === 'string') {
            fullResponseText += msg.content;
          }
          if (msg.type === 'finish' || msg.status === 'finish') {
            isFinished = true;
          }
        }
      });

      // Disparar mensaje al Worker Task Manager
      await task.sendMessage({
        msg_id: msgId,
        input: prompt,
        content: prompt,
      });

      const timeoutMs = 25000;
      while (Date.now() - startTime < timeoutMs) {
        if (fullResponseText.trim().length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      unsub3();

      // Si no se capturó stream en vivo o está vacío, consultar el último mensaje de la asistente en la base de datos
      if (!fullResponseText.trim()) {
        const { getDatabase } = await import('@process/services/database/export');
        const db = await getDatabase();
        const msgs = db.getConversationMessages(activeConv.id, 0, 10, 'DESC');
        
        const assistantMsgs = msgs.data?.filter((m: any) => 
          (m.position === 'left' || m.role === 'assistant' || m.role === 'agent') &&
          m.msg_id !== 'status_' + activeConv.id
        ) || [];

        const lastAssistant = assistantMsgs[0];
        if (lastAssistant) {
          let rawContent = lastAssistant.content;
          if (typeof rawContent === 'string') {
            try {
              const parsed = JSON.parse(rawContent);
              if (parsed && typeof parsed.content === 'string') {
                fullResponseText = parsed.content;
              } else {
                fullResponseText = rawContent;
              }
            } catch {
              fullResponseText = rawContent;
            }
          } else if ((rawContent as any)?.content) {
            fullResponseText = (rawContent as any).content;
          } else {
            fullResponseText = JSON.stringify(rawContent);
          }
        }
      }

      const speechOutput = fullResponseText.trim() || `No se pudo obtener respuesta del agente por voz.`;

      if (typeof (global as any).broadcastVoiceEvent === 'function') {
        (global as any).broadcastVoiceEvent({
          type: 'speech',
          text: speechOutput,
          profile: profile || 'secretaria',
          conversationId: activeConv.id
        });
      }

      res.json({
        ok: true,
        id: `resp_${Date.now()}`,
        response: speechOutput,
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: speechOutput }]
          }
        ],
        conversationId: activeConv.id
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: errorMsg });
    }
  });

  /**
   * GET /api/chat/history
   * Obtiene las conversaciones guardadas por perfil (secretaria, dev, etc.)
   */
  app.get('/api/chat/history', async (req: Request, res: Response) => {
    try {
      const { SqliteConversationRepository } = await import('@process/services/database/SqliteConversationRepository');
      const repo = new SqliteConversationRepository();
      const profile = (req.query.profile as string) || 'secretaria';
      const targetBackend = profile.startsWith('hermes-') ? profile : `hermes-${profile}`;

      const conversations = await repo.listAllConversations();
      const filtered = conversations
        .filter((c: any) => c.extra?.backend === targetBackend || c.extra?.agentType === targetBackend)
        .map((c: any) => ({
          id: c.id,
          title: c.title || `Sesión ${c.id.substring(0, 8)}`,
          updatedAt: c.updatedAt,
          createdAt: c.createdAt,
        }));

      res.json({ ok: true, conversations: filtered });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: errorMsg });
    }
  });

  // Suscriptores SSE para el HUD de Conciencia Web
  const voiceSseClients: Response[] = [];

  app.get('/api/voice/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    voiceSseClients.push(res);
    req.on('close', () => {
      const idx = voiceSseClients.indexOf(res);
      if (idx !== -1) voiceSseClients.splice(idx, 1);
    });
  });

  // Función global helper para notificar estado de voz a clientes web
  (global as any).broadcastVoiceEvent = (eventData: any) => {
    const payload = `data: ${JSON.stringify(eventData)}\n\n`;
    voiceSseClients.forEach((client) => {
      try { client.write(payload); } catch (e) { /* client closed */ }
    });
  };
}







