<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- IconBdt — icon Lucide (nét 24, stroke 2) theo tên dùng trong cau-hinh.ts. -->
<template>
  <component :is="bang[ten] ?? Circle" :size="size" :stroke-width="2" aria-hidden="true" />
</template>

<script setup lang="ts">
import {
  BadgeDollarSign, Bot, Calculator, CalendarClock, Circle, Database, KeyRound, MessageSquare, Printer, ShieldCheck,
  User, UserCheck, UserRound, Users, Warehouse, Wrench,
} from 'lucide-vue-next';
import type { Component } from 'vue';

withDefaults(defineProps<{ ten: string; size?: number }>(), { size: 14 });

const bang: Record<string, Component> = {
  'message-square': MessageSquare, user: User, 'key-round': KeyRound, 'user-check': UserCheck, warehouse: Warehouse,
  'shield-check': ShieldCheck, calculator: Calculator, 'badge-dollar-sign': BadgeDollarSign, wrench: Wrench,
  'user-round': UserRound, users: Users, printer: Printer, database: Database, 'calendar-clock': CalendarClock, bot: Bot,
};
</script>
