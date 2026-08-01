import React, { useEffect, useState } from 'react';
import { Modal, Form, Input, Checkbox, Message } from '@arco-design/web-react';
import { ConfigStorage } from '@/common/config/storage';
import { ipcBridge } from '@/common';
import type { AcpBackendConfig } from '@/common/types/acpTypes';

export type AgentModalTarget =
  | { variant: 'builtin'; backend: string; effective: Partial<AcpBackendConfig> }
  | { variant: 'custom'; record: AcpBackendConfig; store: 'acp.customAgents' | 'assistants' }
  | { variant: 'create' };

interface AddCustomAgentModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  target: AgentModalTarget;
}

interface AgentFormValues {
  name?: string;
  defaultCliPath?: string;
  acpArgs?: string;
  skipConstitution?: boolean;
  skipRulesInjection?: boolean;
  skipSkillsInjection?: boolean;
  skipMemoryInjection?: boolean;
  skipProviderEnv?: boolean;
  skipModelControl?: boolean;
  disableBuiltinMcp?: boolean;
}

function computeInitialValues(target: AgentModalTarget): AgentFormValues {
  if (target.variant === 'builtin') {
    const e = target.effective;
    return {
      skipConstitution: Boolean(e.skipConstitution),
      skipRulesInjection: Boolean(e.skipRulesInjection),
      skipSkillsInjection: Boolean(e.skipSkillsInjection),
      skipMemoryInjection: Boolean(e.skipMemoryInjection),
      skipProviderEnv: Boolean(e.skipProviderEnv),
      skipModelControl: Boolean(e.skipModelControl),
      disableBuiltinMcp: Boolean(e.disableBuiltinMcp),
    };
  }
  if (target.variant === 'custom') {
    const r = target.record;
    return {
      name: r.name,
      defaultCliPath: r.defaultCliPath,
      acpArgs: Array.isArray(r.acpArgs) ? r.acpArgs.join(' ') : '',
      skipConstitution: r.skipConstitution ?? true,
      skipRulesInjection: r.skipRulesInjection ?? true,
      skipSkillsInjection: r.skipSkillsInjection ?? true,
      skipMemoryInjection: r.skipMemoryInjection ?? false,
      skipProviderEnv: r.skipProviderEnv ?? true,
      skipModelControl: r.skipModelControl ?? false,
      disableBuiltinMcp: r.disableBuiltinMcp ?? false,
    };
  }
  return {
    name: '',
    defaultCliPath: 'hermes',
    acpArgs: 'acp --profile dev',
    skipConstitution: true,
    skipRulesInjection: true,
    skipSkillsInjection: true,
    skipMemoryInjection: false,
    skipProviderEnv: true,
    skipModelControl: false,
    disableBuiltinMcp: false,
  };
}

export const AddCustomAgentModal: React.FC<AddCustomAgentModalProps> = ({ visible, onClose, onSuccess, target }) => {
  const [form] = Form.useForm<AgentFormValues>();
  const [submitting, setSubmitting] = useState(false);

  // Arco Form initialValues only apply at mount; re-seed on every open/target change.
  useEffect(() => {
    if (visible) {
      form.resetFields();
      form.setFieldsValue(computeInitialValues(target));
    }
  }, [visible, target, form]);

  const handleSubmit = async () => {
    try {
      const values = (await form.validate()) as AgentFormValues;
      setSubmitting(true);

      const skips = {
        skipConstitution: Boolean(values.skipConstitution),
        skipRulesInjection: Boolean(values.skipRulesInjection),
        skipSkillsInjection: Boolean(values.skipSkillsInjection),
        skipMemoryInjection: Boolean(values.skipMemoryInjection),
        skipProviderEnv: Boolean(values.skipProviderEnv),
        skipModelControl: Boolean(values.skipModelControl),
        disableBuiltinMcp: Boolean(values.disableBuiltinMcp),
      };

      if (target.variant === 'builtin') {
        const overrides = (await ConfigStorage.get('acp.backendOverrides')) || {};
        overrides[target.backend] = skips;
        await ConfigStorage.set('acp.backendOverrides', overrides);
        Message.success('Integraciones del CLI actualizadas (aplican al próximo inicio del agente)');
        onSuccess();
        onClose();
        return;
      }

      const argsArray = values.acpArgs
        ? values.acpArgs
            .split(' ')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];

      const id = target.variant === 'custom' ? target.record.id : `custom-${Date.now()}`;
      const record: AcpBackendConfig = {
        ...(target.variant === 'custom' ? target.record : {}),
        id,
        name: values.name || id,
        defaultCliPath: values.defaultCliPath,
        acpArgs: argsArray,
        ...skips,
        isPreset: false,
        enabled: true,
      };

      const customs = (await ConfigStorage.get('acp.customAgents')) || [];
      const idx = customs.findIndex((a) => a.id === id);
      const updated = idx >= 0 ? customs.map((a, i) => (i === idx ? record : a)) : [...customs, record];
      await ConfigStorage.set('acp.customAgents', updated);

      // Legacy profiles saved in `assistants` migrate to acp.customAgents on edit
      // so the detector lists them and resolveBackendConfig reads one source.
      if (target.variant === 'custom' && target.store === 'assistants') {
        const assistants = (await ConfigStorage.get('assistants')) || [];
        await ConfigStorage.set(
          'assistants',
          assistants.filter((a) => a.id !== id)
        );
      }

      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      Message.success('Perfil / Agente CLI guardado correctamente');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('[AddCustomAgentModal] Submit failed', err);
    } finally {
      setSubmitting(false);
    }
  };

  const isBuiltin = target.variant === 'builtin';
  const title = isBuiltin
    ? `Editar integraciones de ${target.effective.name ?? target.backend}`
    : target.variant === 'custom'
      ? 'Editar Perfil / CLI Custom'
      : 'Agregar Nuevo Perfil de Hermes / CLI';

  return (
    <Modal
      title={title}
      visible={visible}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={submitting}
      okText='Guardar'
      cancelText='Cancelar'
    >
      <Form form={form} layout='vertical' initialValues={computeInitialValues(target)}>
        {!isBuiltin && (
          <>
            <Form.Item label='Nombre del Perfil' field='name' rules={[{ required: true, message: 'Ingresa un nombre' }]}>
              <Input placeholder='Ej: Hermes Dev, Mi Kiro Custom, etc.' />
            </Form.Item>

            <Form.Item
              label='Comando CLI o Ruta'
              field='defaultCliPath'
              rules={[{ required: true, message: 'Ingresa el ejecutable o ruta' }]}
            >
              <Input placeholder='Ej: hermes, kiro-cli, /usr/local/bin/my-cli' />
            </Form.Item>

            <Form.Item label='Argumentos de inicio (opcional)' field='acpArgs'>
              <Input placeholder='Ej: acp --profile dev' />
            </Form.Item>
          </>
        )}

        <div className='bg-[var(--color-fill-2)] p-3 rounded-lg flex flex-col gap-2 mt-4'>
          <div className='text-12px font-bold text-t-secondary uppercase tracking-wider mb-1'>
            Configuración de Omisión (Skips)
          </div>

          <Form.Item field='skipConstitution' triggerPropName='checked' noStyle>
            <Checkbox>⚡ Omitir Constitución de Wayland (Mantener personalidad propia)</Checkbox>
          </Form.Item>

          <Form.Item field='skipRulesInjection' triggerPropName='checked' noStyle>
            <Checkbox>🚫 Omitir Inyección de Reglas Generales</Checkbox>
          </Form.Item>

          <Form.Item field='skipSkillsInjection' triggerPropName='checked' noStyle>
            <Checkbox>📦 Omitir Inyección del Índice de Skills</Checkbox>
          </Form.Item>

          <Form.Item field='skipMemoryInjection' triggerPropName='checked' noStyle>
            <Checkbox>🧠 Omitir Inyección de Memoria de Wayland</Checkbox>
          </Form.Item>

          <Form.Item field='skipProviderEnv' triggerPropName='checked' noStyle>
            <Checkbox>🔑 Omitir Inyección de API Keys de Wayland (Usar login/config propio del CLI)</Checkbox>
          </Form.Item>

          <Form.Item field='skipModelControl' triggerPropName='checked' noStyle>
            <Checkbox>🎛 Ignorar modelos de Wayland (el CLI usa su propio modelo; mantiene constitución, reglas y skills)</Checkbox>
          </Form.Item>

          <Form.Item field='disableBuiltinMcp' triggerPropName='checked' noStyle>
            <Checkbox>🔌 Desactivar Servidores MCP Integrados</Checkbox>
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
};

export default AddCustomAgentModal;
