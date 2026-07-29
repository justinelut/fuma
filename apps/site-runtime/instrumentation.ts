export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeDrainSignals } = await import('./lib/node-drain')
    registerNodeDrainSignals()
  }
}
