export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          app_name: string
          app_subtitle: string
          id: string
          logo_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_name?: string
          app_subtitle?: string
          id?: string
          logo_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_name?: string
          app_subtitle?: string
          id?: string
          logo_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      auto_read_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          pattern: string
          source_id: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          pattern: string
          source_id?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          pattern?: string
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_read_rules_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "webhook_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      callout_requests: {
        Row: {
          admin_note: string | null
          camera: string | null
          created_at: string
          id: string
          instance_id: string
          reason: string | null
          requested_by: string | null
          requester_name: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          admin_note?: string | null
          camera?: string | null
          created_at?: string
          id?: string
          instance_id: string
          reason?: string | null
          requested_by?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          admin_note?: string | null
          camera?: string | null
          created_at?: string
          id?: string
          instance_id?: string
          reason?: string | null
          requested_by?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: []
      }
      callout_settings: {
        Row: {
          id: string
          recipients: string[]
          subject: string
          updated_at: string
        }
        Insert: {
          id?: string
          recipients?: string[]
          subject?: string
          updated_at?: string
        }
        Update: {
          id?: string
          recipients?: string[]
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      camera_arm_schedule_runs: {
        Row: {
          camera: string
          instance_id: string
          last_action: string
          last_run_at: string
        }
        Insert: {
          camera: string
          instance_id: string
          last_action: string
          last_run_at?: string
        }
        Update: {
          camera?: string
          instance_id?: string
          last_action?: string
          last_run_at?: string
        }
        Relationships: []
      }
      camera_arm_schedules: {
        Row: {
          arm_time: string | null
          camera: string
          created_at: string
          disarm_time: string | null
          enabled: boolean
          id: string
          instance_id: string
          updated_at: string
          updated_by: string | null
          user_id: string
          weekday: number
        }
        Insert: {
          arm_time?: string | null
          camera: string
          created_at?: string
          disarm_time?: string | null
          enabled?: boolean
          id?: string
          instance_id: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
          weekday: number
        }
        Update: {
          arm_time?: string | null
          camera?: string
          created_at?: string
          disarm_time?: string | null
          enabled?: boolean
          id?: string
          instance_id?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
          weekday?: number
        }
        Relationships: []
      }
      camera_armed_state: {
        Row: {
          armed: boolean
          camera: string
          id: string
          instance_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          armed?: boolean
          camera: string
          id?: string
          instance_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          armed?: boolean
          camera?: string
          id?: string
          instance_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      camera_status: {
        Row: {
          camera: string
          id: string
          instance_id: string
          last_checked: string
          online: boolean
          since: string
        }
        Insert: {
          camera: string
          id?: string
          instance_id: string
          last_checked?: string
          online: boolean
          since?: string
        }
        Update: {
          camera?: string
          id?: string
          instance_id?: string
          last_checked?: string
          online?: boolean
          since?: string
        }
        Relationships: []
      }
      customer_camera_assignments: {
        Row: {
          camera: string
          created_at: string
          created_by: string | null
          id: string
          instance_id: string
          user_id: string
        }
        Insert: {
          camera: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id: string
          user_id: string
        }
        Update: {
          camera?: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_nvr_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          instance_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_offline_instructions: {
        Row: {
          camera: string | null
          id: string
          instance_id: string
          instructions: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          camera?: string | null
          id?: string
          instance_id: string
          instructions?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          camera?: string | null
          id?: string
          instance_id?: string
          instructions?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      daily_report_configs: {
        Row: {
          body_template: string
          created_at: string
          enabled: boolean
          id: string
          instance_id: string
          last_sent_at: string | null
          recipients: string[]
          subject: string
          updated_at: string
        }
        Insert: {
          body_template?: string
          created_at?: string
          enabled?: boolean
          id?: string
          instance_id: string
          last_sent_at?: string | null
          recipients?: string[]
          subject?: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          created_at?: string
          enabled?: boolean
          id?: string
          instance_id?: string
          last_sent_at?: string | null
          recipients?: string[]
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_configs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: true
            referencedRelation: "frigate_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_runs: {
        Row: {
          config_id: string | null
          error: string | null
          id: string
          instance_id: string | null
          recipients: string[]
          sent_at: string
          status: string
          subject: string | null
        }
        Insert: {
          config_id?: string | null
          error?: string | null
          id?: string
          instance_id?: string | null
          recipients?: string[]
          sent_at?: string
          status: string
          subject?: string | null
        }
        Update: {
          config_id?: string | null
          error?: string | null
          id?: string
          instance_id?: string | null
          recipients?: string[]
          sent_at?: string
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_runs_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "daily_report_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_settings: {
        Row: {
          from_email: string
          from_name: string
          id: string
          reply_to: string | null
          send_hour_utc: number
          send_minute_utc: number
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number
          smtp_secure: string
          smtp_username: string | null
          updated_at: string
        }
        Insert: {
          from_email?: string
          from_name?: string
          id?: string
          reply_to?: string | null
          send_hour_utc?: number
          send_minute_utc?: number
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number
          smtp_secure?: string
          smtp_username?: string | null
          updated_at?: string
        }
        Update: {
          from_email?: string
          from_name?: string
          id?: string
          reply_to?: string | null
          send_hour_utc?: number
          send_minute_utc?: number
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number
          smtp_secure?: string
          smtp_username?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      event_audit_log: {
        Row: {
          action: string
          actor: string | null
          alert_key: string
          event_id: string | null
          id: string
          note: string | null
          ts: string
        }
        Insert: {
          action: string
          actor?: string | null
          alert_key: string
          event_id?: string | null
          id?: string
          note?: string | null
          ts?: string
        }
        Update: {
          action?: string
          actor?: string | null
          alert_key?: string
          event_id?: string | null
          id?: string
          note?: string | null
          ts?: string
        }
        Relationships: []
      }
      frigate_instances: {
        Row: {
          api_key: string | null
          base_url: string
          color: string
          created_at: string
          enabled: boolean
          id: string
          is_local: boolean
          last_error: string | null
          last_event_ts: string | null
          last_polled_at: string | null
          mute_enabled: boolean
          mute_end: string | null
          mute_start: string | null
          name: string
          poll_enabled: boolean
          poll_interval_seconds: number
          source_id: string
        }
        Insert: {
          api_key?: string | null
          base_url: string
          color?: string
          created_at?: string
          enabled?: boolean
          id?: string
          is_local?: boolean
          last_error?: string | null
          last_event_ts?: string | null
          last_polled_at?: string | null
          mute_enabled?: boolean
          mute_end?: string | null
          mute_start?: string | null
          name: string
          poll_enabled?: boolean
          poll_interval_seconds?: number
          source_id: string
        }
        Update: {
          api_key?: string | null
          base_url?: string
          color?: string
          created_at?: string
          enabled?: boolean
          id?: string
          is_local?: boolean
          last_error?: string | null
          last_event_ts?: string | null
          last_polled_at?: string | null
          mute_enabled?: boolean
          mute_end?: string | null
          mute_start?: string | null
          name?: string
          poll_enabled?: boolean
          poll_interval_seconds?: number
          source_id?: string
        }
        Relationships: []
      }
      media_items: {
        Row: {
          camera: string | null
          event_id: string | null
          frigate_event_id: string | null
          id: string
          instance_id: string | null
          kind: string
          source_id: string
          topic: string | null
          ts: string
          url: string
        }
        Insert: {
          camera?: string | null
          event_id?: string | null
          frigate_event_id?: string | null
          id?: string
          instance_id?: string | null
          kind: string
          source_id: string
          topic?: string | null
          ts?: string
          url: string
        }
        Update: {
          camera?: string | null
          event_id?: string | null
          frigate_event_id?: string | null
          id?: string
          instance_id?: string | null
          kind?: string
          source_id?: string
          topic?: string | null
          ts?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_items_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "webhook_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_items_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "webhook_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      media_tags: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          media_id: string
          note: string | null
          tag: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          media_id: string
          note?: string | null
          tag: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          media_id?: string
          note?: string | null
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_tags_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_items"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_instruction_acks: {
        Row: {
          acknowledged_at: string
          camera: string
          id: string
          instance_id: string
          since: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          camera: string
          id?: string
          instance_id: string
          since: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          camera?: string
          id?: string
          instance_id?: string
          since?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          contact_email: string | null
          created_at: string
          display_name: string | null
          id: string
          must_change_password: boolean
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          contact_email?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          must_change_password?: boolean
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          contact_email?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          must_change_password?: boolean
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          archived: boolean
          camera: string | null
          frigate_event_id: string | null
          headers: Json
          id: string
          kind: string
          label: string | null
          payload: Json
          payload_text: string | null
          read: boolean
          score: number | null
          source_id: string
          topic: string
          ts: string
        }
        Insert: {
          archived?: boolean
          camera?: string | null
          frigate_event_id?: string | null
          headers?: Json
          id?: string
          kind?: string
          label?: string | null
          payload?: Json
          payload_text?: string | null
          read?: boolean
          score?: number | null
          source_id: string
          topic?: string
          ts?: string
        }
        Update: {
          archived?: boolean
          camera?: string | null
          frigate_event_id?: string | null
          headers?: Json
          id?: string
          kind?: string
          label?: string | null
          payload?: Json
          payload_text?: string | null
          read?: boolean
          score?: number | null
          source_id?: string
          topic?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "webhook_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_sources: {
        Row: {
          color: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          secret: string
          slug: string
        }
        Insert: {
          color?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          secret: string
          slug: string
        }
        Update: {
          color?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          secret?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      user_has_camera: {
        Args: { _camera: string; _instance_id: string; _user_id: string }
        Returns: boolean
      }
      user_has_instance: {
        Args: { _instance_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "customer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "customer"],
    },
  },
} as const
