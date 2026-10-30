import { useQuery } from '@tanstack/react-query';

import { api, API_URL } from '../api/client';
import { qk } from '../api/keys';
import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { CardSkeleton, ErrorState } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';

type Meta = { name: string; version: string; deviceTz: string; serverTime: string };

export default function Home() {
  const meta = useQuery({ queryKey: qk.meta(), queryFn: () => api<Meta>('/api/v1/meta', { auth: false }) });
  return (
    <Screen refreshing={meta.isRefetching} onRefresh={meta.refetch}>
      <AppText variant="headline">Welcome</AppText>
      <AppText muted>This app helps you look after someone's medicines from your phone.</AppText>
      {meta.isPending ? (
        <CardSkeleton />
      ) : meta.isError ? (
        <ErrorState error={meta.error} onRetry={meta.refetch} />
      ) : (
        <Card>
          <StatusBadge status="online" label="Server connected" />
          <AppText>{meta.data.name}</AppText>
          <AppText muted>Pillbox time: {new Date(meta.data.serverTime).toLocaleString()}</AppText>
          <AppText variant="caption" muted>
            {API_URL}
          </AppText>
        </Card>
      )}
    </Screen>
  );
}
