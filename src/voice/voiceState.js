export const isVoiceActive = (value) => typeof value?.id === 'string' && value.connections?.[value.id] === true;
export function voiceLevel(samples) {
  return Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
}

export function summarizeVoiceStats(reports) {
  let roundTripMs = null, jitterMs = null, received = 0, lost = 0;
  for (const report of reports) for (const stat of report?.values?.() || []) {
    if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && Number.isFinite(stat.currentRoundTripTime)) {
      roundTripMs = Math.max(roundTripMs || 0, Math.round(stat.currentRoundTripTime * 1000));
    }
    if (stat.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio')) {
      if (Number.isFinite(stat.jitter)) jitterMs = Math.max(jitterMs || 0, Math.round(stat.jitter * 1000));
      received += Math.max(0, stat.packetsReceived || 0); lost += Math.max(0, stat.packetsLost || 0);
    }
  }
  const packetLoss = received + lost > 0 ? lost / (received + lost) : null;
  return { roundTripMs, jitterMs, packetLoss,
    quality: roundTripMs > 500 || jitterMs > 50 || packetLoss > 0.08 ? 'unstable' : roundTripMs !== null || jitterMs !== null ? 'good' : 'unknown' };
}
