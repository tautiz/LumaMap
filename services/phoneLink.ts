import type { DataConnection, PeerJSOption } from 'peerjs';

// Link between the calibration dialog (on the computer) and the phone camera page (?camera=<id>).
//
// The two find each other through PeerJS's free public server, then talk directly (WebRTC), so the
// photos go straight from the phone to the computer. Nothing has to be set up. For testing, or to use
// an own server, `?peer=host:port` on both pages points them to another PeerJS server.

export type Shot = 'white' | 'black';

// Phone -> computer
export type PhoneMessage =
  | { type: 'hello' }
  | { type: 'start' }
  | { type: 'frame'; shot: Shot; data: ArrayBuffer; mime: string };

// Computer -> phone
export type ComputerMessage =
  | { type: 'ready' }
  | { type: 'capture'; shot: Shot }
  | { type: 'state'; state: 'running' | 'done' | 'failed' };

// Where the phone page lives. A phone camera only works on an https page, so when this app runs from
// a plain http address (e.g. on the local network) the phone opens the public copy instead.
const PUBLIC_APP = 'https://tautiz.github.io/LumaMap/';

const customServer = (): string | null => new URLSearchParams(window.location.search).get('peer');

const peerOptions = (): PeerJSOption => {
  const server = customServer();
  if (!server) return {};
  const [host, port] = server.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: window.location.protocol === 'https:' };
};

export const cameraPageUrl = (id: string) => {
  const here = window.location.origin + window.location.pathname;
  const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
  const base = window.location.protocol === 'https:' || (local && customServer()) ? here : PUBLIC_APP;
  const url = new URL(base);
  url.searchParams.set('camera', id);
  const server = customServer();
  if (server) url.searchParams.set('peer', server);
  return url.toString();
};

const loadPeer = async () => (await import('peerjs')).Peer;

const newId = () => 'lumamap-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');

export interface ComputerLink {
  id: string;
  send: (msg: ComputerMessage) => void;
  close: () => void;
}

/** The computer side: waits for a phone. The newest phone to connect is the one used. */
export const openComputerLink = async (handlers: {
  onPhone: (connected: boolean) => void;
  onMessage: (msg: PhoneMessage) => void;
  onError: (e: unknown) => void;
}): Promise<ComputerLink> => {
  const Peer = await loadPeer();
  const peer = new Peer(newId(), peerOptions());
  let conn: DataConnection | null = null;
  const id = await new Promise<string>((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });
  peer.on('error', handlers.onError);
  // A lost link to the matchmaking server does not matter once the phone is connected; try to keep it anyway.
  peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  peer.on('connection', c => {
    conn?.close();
    conn = c;
    c.on('open', () => handlers.onPhone(true));
    c.on('data', data => handlers.onMessage(data as PhoneMessage));
    c.on('close', () => { if (conn === c) { conn = null; handlers.onPhone(false); } });
  });
  return {
    id,
    send: msg => { conn?.open && conn.send(msg); },
    close: () => peer.destroy(),
  };
};

export interface PhoneLink {
  send: (msg: PhoneMessage) => void;
  close: () => void;
}

/** The phone side: connects to the computer with that id. */
export const openPhoneLink = async (computerId: string, handlers: {
  onOpen: () => void;
  onMessage: (msg: ComputerMessage) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}): Promise<PhoneLink> => {
  const Peer = await loadPeer();
  const peer = new Peer(peerOptions());
  await new Promise<void>((resolve, reject) => {
    peer.on('open', () => resolve());
    peer.on('error', reject);
  });
  peer.on('error', handlers.onError);
  const conn = peer.connect(computerId, { reliable: true });
  conn.on('open', handlers.onOpen);
  conn.on('data', data => handlers.onMessage(data as ComputerMessage));
  conn.on('close', handlers.onClose);
  conn.on('error', handlers.onError);
  return {
    send: msg => { if (conn.open) conn.send(msg); },
    close: () => peer.destroy(),
  };
};
