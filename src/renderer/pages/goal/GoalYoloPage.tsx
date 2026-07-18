import React, { useState, useEffect } from 'react';
import { Button, Input, Message, Typography, Select, Space } from '@arco-design/web-react';
import { Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { conversation } from '@/common/adapter/ipcBridge';
import { buildPresetAssistantParams } from '@renderer/pages/conversation/utils/createConversationParams';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { useTranslation } from 'react-i18next';

export const GoalYoloPage: React.FC = () => {
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('homelab');
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const { presetAssistants, cliAgents } = useConversationAgents();

  useEffect(() => {
    // If homelab is not available, default to the first available preset assistant or CLI agent starting with hermes
    const hasHomelab = presetAssistants.some((a) => a.customAgentId === 'homelab');
    if (!hasHomelab) {
      const firstHermesPreset = presetAssistants.find((a) => a.backend?.startsWith('hermes'));
      const firstHermesCli = cliAgents.find((a) => a.backend?.startsWith('hermes'));
      if (firstHermesPreset) {
        setSelectedAgent(firstHermesPreset.customAgentId || firstHermesPreset.name);
      } else if (firstHermesCli) {
        setSelectedAgent(firstHermesCli.customAgentId || firstHermesCli.name);
      }
    }
  }, [presetAssistants, cliAgents]);

  const handleLaunch = async () => {
    if (!goal.trim()) {
      Message.warning('Please enter a goal first.');
      return;
    }

    setLoading(true);
    try {
      // Find the selected agent
      const agentInfo =
        presetAssistants.find((a) => (a.customAgentId || a.name) === selectedAgent) ||
        cliAgents.find((a) => (a.customAgentId || a.name) === selectedAgent) ||
        presetAssistants[0] ||
        cliAgents[0];

      if (!agentInfo) {
        throw new Error('No agents available to launch.');
      }

      const params = await buildPresetAssistantParams(
        agentInfo,
        '', // No workspace for global goals unless specified
        i18n.language
      );

      // Override the mode to YOLO so it runs autonomously
      params.extra = params.extra || {};
      params.extra.yoloMode = true;
      params.extra.sessionMode = 'yolo'; // Enforce autonomous

      const newConv = await conversation.create.invoke(params);

      // Store the initial message in sessionStorage for all platform hooks to pick up upon mounting
      const messageData = JSON.stringify({ input: goal, files: [] });
      sessionStorage.setItem(`acp_initial_message_${newConv.id}`, messageData);
      sessionStorage.setItem(`gemini_initial_message_${newConv.id}`, messageData);
      sessionStorage.setItem(`wcore_initial_message_${newConv.id}`, messageData);
      sessionStorage.setItem(`openclaw_initial_message_${newConv.id}`, messageData);
      sessionStorage.setItem(`nanobot_initial_message_${newConv.id}`, messageData);
      sessionStorage.setItem(`remote_initial_message_${newConv.id}`, messageData);

      // Navigate to the chat page. The respective chat component will auto-mount and start the session
      navigate(`/conversation/${newConv.id}`);
    } catch (err: any) {
      Message.error(`Failed to launch YOLO agent: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const hermesPresets = presetAssistants.filter((agent) => agent.backend?.startsWith('hermes'));
  const hermesCliAgents = cliAgents.filter((agent) => agent.backend?.startsWith('hermes'));

  return (
    <div style={{ maxWidth: '600px', margin: '100px auto', padding: '20px', textAlign: 'center' }}>
      <Target size={48} style={{ color: 'var(--color-primary-light-4)', marginBottom: 20 }} />
      <Typography.Title heading={3}>YOLO Goal Execution</Typography.Title>
      <Typography.Paragraph type='secondary' style={{ marginBottom: 30 }}>
        Enter an objective. The agent will execute it autonomously without stopping to ask for permission. It will run
        in YOLO mode until completion.
      </Typography.Paragraph>

      <div style={{ textAlign: 'left', marginBottom: 20 }}>
        <Typography.Text style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
          Select Agent Preset:
        </Typography.Text>
        <Select
          placeholder='Select agent'
          value={selectedAgent}
          onChange={setSelectedAgent}
          size='large'
          style={{ width: '100%' }}
        >
          {hermesPresets.map((agent) => (
            <Select.Option key={agent.customAgentId || agent.name} value={agent.customAgentId || agent.name}>
              {agent.name} {agent.isPreset ? '(Preset)' : ''}
            </Select.Option>
          ))}
          {hermesCliAgents.map((agent) => (
            <Select.Option key={agent.customAgentId || agent.name} value={agent.customAgentId || agent.name}>
              {agent.name} (CLI Engine)
            </Select.Option>
          ))}
        </Select>
      </div>

      <div style={{ textAlign: 'left', marginBottom: 20 }}>
        <Typography.Text style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
          Objective / Goal:
        </Typography.Text>
        <Input.TextArea
          placeholder='E.g. Create a new Next.js app in /home/zero/app, install tailwind, and deploy to Vercel.'
          autoSize={{ minRows: 4, maxRows: 10 }}
          value={goal}
          onChange={setGoal}
          style={{ fontSize: 16 }}
        />
      </div>

      <Button
        type='primary'
        size='large'
        icon={<Target />}
        loading={loading}
        onClick={handleLaunch}
        style={{ width: '100%' }}
      >
        Launch YOLO Agent
      </Button>
    </div>
  );
};

export default GoalYoloPage;
