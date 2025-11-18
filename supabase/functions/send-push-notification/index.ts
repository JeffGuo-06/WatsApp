import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: {
    id: string;
    course_chat_id: string;
    user_id: string;
    content: string;
    created_at: string;
  };
  schema: string;
}

Deno.serve(async (req: Request) => {
  try {
    const payload: WebhookPayload = await req.json();

    // Extract message details
    const { record } = payload;
    const { course_chat_id, user_id: sender_id, content, id: message_id } = record;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Get all enrolled users for this course (except the sender)
    const enrolledUsersResponse = await fetch(
      `${supabaseUrl}/rest/v1/user_courses?select=user_id,courses!inner(course_name,course_code,course_chats!inner(id))&courses.course_chats.id=eq.${course_chat_id}&user_id=neq.${sender_id}`,
      {
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
      }
    );

    if (!enrolledUsersResponse.ok) {
      throw new Error('Failed to fetch enrolled users');
    }

    const enrolledUsers = await enrolledUsersResponse.json();

    if (!enrolledUsers || enrolledUsers.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: 'No recipients' }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Get sender's profile for notification
    const senderProfileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=name&id=eq.${sender_id}&limit=1`,
      {
        headers: {
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
      }
    );

    const senderProfiles = await senderProfileResponse.json();
    const senderName = senderProfiles?.[0]?.name || 'Someone';
    const courseName = enrolledUsers[0]?.courses?.course_code || 'Course';

    // Prepare push notifications
    const pushMessages = [];

    for (const user of enrolledUsers) {
      const userId = user.user_id;

      // Check if user has push enabled
      const settingsResponse = await fetch(
        `${supabaseUrl}/rest/v1/user_notification_settings?select=push_enabled,show_message_preview,quiet_hours_enabled,quiet_hours_start,quiet_hours_end&user_id=eq.${userId}&limit=1`,
        {
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
        }
      );

      const settings = (await settingsResponse.json())?.[0];

      if (settings && !settings.push_enabled) continue;

      // Check if course is muted
      const courseMuteResponse = await fetch(
        `${supabaseUrl}/rest/v1/course_notification_settings?select=muted&user_id=eq.${userId}&course_chat_id=eq.${course_chat_id}&limit=1`,
        {
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
        }
      );

      const courseMute = (await courseMuteResponse.json())?.[0];

      // Skip if muted
      if (courseMute?.muted) continue;

      // Check quiet hours
      if (
        settings?.quiet_hours_enabled &&
        settings.quiet_hours_start &&
        settings.quiet_hours_end
      ) {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        if (
          currentTime >= settings.quiet_hours_start &&
          currentTime <= settings.quiet_hours_end
        ) {
          continue; // Skip notification during quiet hours
        }
      }

      // Get user's active push tokens
      const tokensResponse = await fetch(
        `${supabaseUrl}/rest/v1/push_tokens?select=push_token,platform&user_id=eq.${userId}&is_active=eq.true`,
        {
          headers: {
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
        }
      );

      const tokens = await tokensResponse.json();

      if (!tokens || tokens.length === 0) continue;

      // Create push notification for each device
      for (const tokenData of tokens) {
        const messageBody =
          settings?.show_message_preview ? content : 'New message';

        pushMessages.push({
          to: tokenData.push_token,
          sound: 'default',
          title: `${senderName} in ${courseName}`,
          body: messageBody.substring(0, 100), // Limit message preview
          data: {
            type: 'course_message',
            course_chat_id: course_chat_id,
            message_id: message_id,
            sender_id: sender_id,
          },
          badge: 1, // Increment badge count
          priority: 'high',
        });
      }
    }

    // Send push notifications via Expo Push API
    if (pushMessages.length > 0) {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pushMessages),
      });

      const result = await response.json();
      console.log('Push notifications sent:', result);

      return new Response(
        JSON.stringify({ success: true, sent: pushMessages.length, result }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, sent: 0, message: 'No tokens or all users muted/disabled' }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error sending push notifications:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
