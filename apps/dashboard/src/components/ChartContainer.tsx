'use client';

import { Card, Text, BlockStack } from '@shopify/polaris';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

type Props = {
  title: string;
  children: React.ReactNode;
};

export function ChartContainer({ title, children }: Props) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h3" variant="headingMd">
          {title}
        </Text>
        <div style={{ width: '100%', height: 260 }}>{children}</div>
      </BlockStack>
    </Card>
  );
}

const COLORS = ['#4f46e5', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4'];

export function VolumeChart({
  data,
}: {
  data: Array<{ day: string; count: number }>;
}) {
  return (
    <ResponsiveContainer>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="count"
          stroke="#4f46e5"
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function IntentChart({
  data,
}: {
  data: Array<{ intent: string; count: number }>;
}) {
  return (
    <ResponsiveContainer>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="intent" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#4f46e5" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SplitChart({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={90} label>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
