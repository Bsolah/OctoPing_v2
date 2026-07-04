import { Card, CardContent, CardHeader, CardTitle } from '@nova/ui';

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Nova Support Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            AI-powered customer support for Shopify.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
