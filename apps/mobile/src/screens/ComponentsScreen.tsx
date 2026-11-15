import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useBanner } from '../banner';
import { AlertDialog, Badge, Button, Card, Checkbox, ContextMenu, Dialog, Field, Input, RadioGroup, Select, Table, Tabs, Toggle, type Column } from '../components/ui';
import type { ShellMetrics } from '../layout/AppShell';
import { useTheme } from '../theme';

interface OrderRow {
  id: string;
  date: string;
  total: string;
  status: { label: string; variant: 'tagAccent' | 'tagNeutral' | 'tagOutline' };
}
const ORDERS: OrderRow[] = [
  { id: 'SO-1042', date: '2026-08-07', total: '₱24.31', status: { label: 'Completed', variant: 'tagAccent' } },
  { id: 'SO-1039', date: '2026-08-06', total: '₱7.28', status: { label: 'Refunded', variant: 'tagNeutral' } },
  { id: 'SO-1037', date: '2026-08-05', total: '₱15.02', status: { label: 'Pending', variant: 'tagOutline' } },
];
const COLUMNS: Column<OrderRow>[] = [
  { key: 'id', title: 'Order', width: 110, render: (r) => r.id },
  { key: 'date', title: 'Date', width: 120, render: (r) => r.date },
  { key: 'total', title: 'Total', width: 100, align: 'right', render: (r) => r.total },
  { key: 'status', title: 'Status', width: 130, render: (r) => <Badge variant={r.status.variant}>{r.status.label}</Badge> },
];

const GAP = 12;

/** Static style showcase of the themed components (no app logic). One column on phones, two on tablets. */
export function ComponentsScreen({ contentWidth, wide }: ShellMetrics) {
  const t = useTheme();
  const banner = useBanner();
  const [payment, setPayment] = useState<string>();
  const [printReceipt, setPrintReceipt] = useState(true);
  const [taxExempt, setTaxExempt] = useState(false);
  const [receiptType, setReceiptType] = useState('print');
  const [dialog, setDialog] = useState(false);
  const [alert, setAlert] = useState(false);
  const [lastAction, setLastAction] = useState('-');

  const half = wide ? Math.floor((contentWidth - GAP) / 2) : contentWidth;
  const full = contentWidth;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, alignItems: 'flex-start' }}>
        <Card title="Buttons and tags" style={{ width: half }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button>Primary</Button>
            <Button variant="outline">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Badge variant="tagOutline">Produce</Badge>
            <Badge variant="tagAccent">Paid</Badge>
            <Badge variant="tagNeutral">Refunded</Badge>
          </View>
        </Card>

        <Card title="Form" style={{ width: half }}>
          <Field label="Cash tendered">
            <Input keyboardType="decimal-pad" placeholder="0.00" />
          </Field>
          <Field label="Quantity">
            <Input keyboardType="number-pad" defaultValue="1" />
          </Field>
          <Field label="Barcode">
            <Input defaultValue="12345" invalid />
          </Field>
          <Field label="Store">
            <Input defaultValue="Main street" editable={false} />
          </Field>
          <Field label="Notes">
            <Input multiline placeholder="Add a note" />
          </Field>
          <Field label="Payment method">
            <Select
              value={payment}
              onChange={setPayment}
              placeholder="Select method"
              options={[
                { value: 'cash', label: 'Cash' },
                { value: 'card', label: 'Card' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </Field>
          <Button>Complete sale</Button>
        </Card>

        <Card title="Selection controls" style={{ width: half }}>
          <Checkbox label="Print receipt" checked={printReceipt} onChange={setPrintReceipt} />
          <Checkbox label="Disabled" checked disabled />
          <Toggle label="Tax exempt" value={taxExempt} onChange={setTaxExempt} />
          <RadioGroup
            value={receiptType}
            onChange={setReceiptType}
            options={[
              { value: 'print', label: 'Print' },
              { value: 'email', label: 'Email' },
              { value: 'none', label: 'None' },
            ]}
          />
        </Card>

        <Card title="Tabs" style={{ width: half }}>
          <Tabs
            tabs={[
              { id: 'open', label: 'Open', content: <Text style={{ color: t.foreground, fontSize: 14 }}>Open orders</Text> },
              { id: 'completed', label: 'Completed', content: <Text style={{ color: t.foreground, fontSize: 14 }}>Completed orders</Text> },
              { id: 'refunded', label: 'Refunded', content: <Text style={{ color: t.foreground, fontSize: 14 }}>Refunded orders</Text> },
            ]}
          />
        </Card>

        <Card title="Dialogs" style={{ width: half }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="outline" onPress={() => setDialog(true)}>
              Open dialog
            </Button>
            <Button variant="outline" onPress={() => setAlert(true)}>
              Void order
            </Button>
          </View>
        </Card>

        <Card title="Context menu" style={{ width: half }}>
          <ContextMenu
            items={[
              { label: 'Open', onPress: () => setLastAction('Open') },
              { label: 'Duplicate', onPress: () => setLastAction('Duplicate') },
              { label: 'Delete', destructive: true, onPress: () => setLastAction('Delete') },
            ]}
          >
            <View style={{ height: 96, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: t.border }}>
              <Text style={{ color: t.foreground, fontSize: 14 }}>Long-press here</Text>
            </View>
          </ContextMenu>
          <Text style={{ color: t.mutedForeground, fontSize: 14 }}>Last action: {lastAction}</Text>
        </Card>

        <Card title="Table" style={{ width: full }}>
          <Table columns={COLUMNS} rows={ORDERS} rowKey={(r) => r.id} />
        </Card>

        <Card title="Banner" style={{ width: full }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button variant="outline" onPress={() => banner.success('Saved')}>
              Timed
            </Button>
            <Button variant="outline" onPress={() => banner.warning('System update at 22:00. Finish open orders.', { key: 'demo-update', persistent: true })}>
              Persistent
            </Button>
            <Button variant="outline" onPress={() => banner.warning('System update at 22:00. Finish open orders.', { key: 'demo-update', persistent: true, dismissible: false })}>
              Persistent (locked)
            </Button>
            <Button variant="outline" onPress={() => banner.remove('demo-update')}>
              Remove persistent
            </Button>
          </View>
        </Card>
      </View>

      <Dialog
        visible={dialog}
        onClose={() => setDialog(false)}
        title="Discount"
        footer={
          <>
            <Button variant="outline" onPress={() => setDialog(false)}>
              Cancel
            </Button>
            <Button onPress={() => setDialog(false)}>Apply</Button>
          </>
        }
      >
        <Field label="Amount">
          <Input keyboardType="decimal-pad" placeholder="0.00" />
        </Field>
      </Dialog>
      <AlertDialog
        visible={alert}
        onClose={() => setAlert(false)}
        title="Void this order?"
        description="The order will be marked as voided. This cannot be undone."
        actionLabel="Void"
        destructive
        onAction={() => banner.success('Order voided')}
      />
    </ScrollView>
  );
}
