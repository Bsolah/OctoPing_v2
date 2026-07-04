'use client';

import { useState } from 'react';
import { Modal, FormLayout, TextField, Select, Banner } from '@shopify/polaris';

type Props = {
  open: boolean;
  onClose: () => void;
  onInvite: (payload: {
    email: string;
    name: string;
    role: string;
  }) => Promise<void>;
};

export function AgentInviteModal({ open, onClose, onInvite }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('agent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await onInvite({ email, name, role });
      setEmail('');
      setName('');
      setRole('agent');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite team member"
      primaryAction={{
        content: 'Send invite',
        onAction: () => void submit(),
        loading,
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <FormLayout>
          {error ? <Banner tone="critical">{error}</Banner> : null}
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            autoComplete="name"
          />
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />
          <Select
            label="Role"
            options={[
              { label: 'Agent', value: 'agent' },
              { label: 'Admin', value: 'admin' },
              { label: 'Viewer', value: 'viewer' },
            ]}
            value={role}
            onChange={setRole}
          />
        </FormLayout>
      </Modal.Section>
    </Modal>
  );
}
