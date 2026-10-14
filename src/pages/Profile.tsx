import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Icon, useAsync } from '../ui';
import { ServerStatus } from '../components';

const label = 'text-xs font-semibold uppercase tracking-widest text-primary px-1';

export function Profile() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const status = useAsync(api.status);
  const m = status.data?.models;
  const out = async () => { await signOut(); nav('/signin', { replace: true }); };
  const row = 'flex items-center gap-4 p-4';
  return (<>
    <Card className="flex items-center gap-4">
      <span className="w-16 h-16 rounded-full bg-primary-fixed flex items-center justify-center text-primary shrink-0"><Icon name="shield_person" fill className="text-[32px]" /></span>
      <div className="min-w-0"><h1 className="font-headline text-2xl font-semibold truncate">{user?.name}</h1><p className="text-sm text-on-surface-variant truncate">{user?.email}</p></div>
    </Card>

    <h2 className={label}>Detection services</h2>
    <Card className="p-0 divide-y divide-outline-variant/40">
      {([['text', 'Text phishing model'], ['audio', 'Voice deepfake model'], ['video', 'Video deepfake model'], ['advisor', 'AI advisor (generative)']] as const).map(([k, n]) => (
        <div key={k} className={`${row} justify-between`}><span className="text-sm font-semibold">{n}</span>
          <span className={`text-xs font-semibold ${m?.[k] ? 'text-primary' : 'text-on-surface-variant'}`}>{m ? (m[k] ? 'Configured' : 'Not configured') : '…'}</span></div>))}
    </Card>

    <h2 className={label}>Backend connection</h2>
    <Card><ServerStatus /></Card>

    <h2 className={label}>Privacy &amp; data</h2>
    <Card className="text-sm text-on-surface-variant space-y-2">
      <p>Uploaded audio and video are processed in temporary storage and deleted immediately after analysis.</p>
      <p>Scan history keeps only the score, label, model name and basic metadata (file name and size, or text length). Message text is never saved, not even as a hash.</p>
    </Card>

    <h2 className={label}>Help</h2>
    <Card className="p-0 divide-y divide-outline-variant/40">
      <Link to="/advisor" className={`${row} justify-between`}><span className="flex items-center gap-4"><Icon name="psychology" className="text-primary" /><span className="text-sm font-semibold">AI Security Assistant</span></span><Icon name="chevron_right" /></Link>
      <Link to="/activity" className={`${row} justify-between`}><span className="flex items-center gap-4"><Icon name="history" className="text-primary" /><span className="text-sm font-semibold">Scan history &amp; reports</span></span><Icon name="chevron_right" /></Link>
    </Card>

    <button onClick={out} className="min-h-[52px] rounded-xl border border-error/30 bg-error-container/50 text-error font-headline font-semibold flex items-center justify-center gap-2"><Icon name="logout" />Log Out</button>
  </>);
}
