import { supabase } from './supabase-client.js'

const supportedFeatures = [
  'announcements',
  'attendance',
  'payment_transactions',
  'notifications',
  'chat_messages',
]

export async function subscribeToSchoolRealtime({
  schoolId,
  onChange = {},
  onPresence = {},
}) {
  if (!schoolId) {
    throw new Error('schoolId is required')
  }

  // Refresh the JWT used for private-channel authorization.
  await supabase.realtime.setAuth()

  const channels = []

  for (const feature of supportedFeatures) {
    const channel = supabase.channel(
      `school:${schoolId}:${feature}`,
      {
        config: {
          private: true,
        },
      }
    )

    channel
      .on('broadcast', { event: '*' }, async (message) => {
        const payload = message?.payload ?? {}

        const callback = onChange[feature]

        if (callback) {
          await callback({
            feature,
            operation: payload.operation,
            recordId: payload.record_id,
            schoolId: payload.school_id,
            table: payload.table,
          })
        }
      })
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          console.debug(`Realtime connected: ${feature}`)
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Realtime error: ${feature}`, error)
        }
      })

    channels.push(channel)
  }

  const presenceChannel = supabase.channel(
    `school:${schoolId}:presence`,
    {
      config: {
        private: true,
        presence: {
          key: crypto.randomUUID(),
        },
      },
    }
  )

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      onPresence.sync?.(presenceChannel.presenceState())
    })
    .on('presence', { event: 'join' }, (event) => {
      onPresence.join?.(event)
    })
    .on('presence', { event: 'leave' }, (event) => {
      onPresence.leave?.(event)
    })
    .subscribe(async (status, error) => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({
          user_id: (await supabase.auth.getUser()).data.user?.id,
          online_at: new Date().toISOString(),
        })
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Presence error', error)
      }
    })

  channels.push(presenceChannel)

  return async function unsubscribe() {
    await Promise.all(
      channels.map((channel) => supabase.removeChannel(channel))
    )
  }
}