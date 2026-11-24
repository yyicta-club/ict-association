<script setup lang="ts">
import type {AdminMessage, MessageStatus} from '~/data/admin'
import {mockMessages} from '~/data/admin'

definePageMeta({layout: 'admin'})

useHead({title: '留言管理 · 管理后台 · 信息通信技术协会'})

const {push} = useToast()

const messages = ref<AdminMessage[]>([...mockMessages])
const filter = ref<'全部' | MessageStatus>('全部')
const expanded = ref<number[]>([])
const removing = ref<number[]>([])

const statusTabs = computed(() => [
    {label: '全部', value: '全部' as const, count: messages.value.length},
    {label: '待处理', value: 'pending' as const, count: messages.value.filter(m => m.status === 'pending').length},
    {label: '已回复', value: 'replied' as const, count: messages.value.filter(m => m.status === 'replied').length},
    {label: '已忽略', value: 'ignored' as const, count: messages.value.filter(m => m.status === 'ignored').length}
])

const filtered = computed(() => filter.value === '全部'
    ? messages.value
    : messages.value.filter(message => message.status === filter.value))

function toggleExpand(id: number) {
    expanded.value = expanded.value.includes(id)
        ? expanded.value.filter(item => item !== id)
        : [...expanded.value, id]
}

function setStatus(id: number, status: MessageStatus) {
    const message = messages.value.find(item => item.id === id)
    if (!message) return
    message.status = status
    const labels: Record<MessageStatus, string> = {
        pending: '已标记为待处理',
        replied: '已标记为已回复',
        ignored: '已忽略该留言'
    }
    push({type: 'success', title: labels[status], description: '演示模式 · 未接入后端'})
}

function removeMessage(id: number) {
    removing.value = [id]
    setTimeout(() => {
        messages.value = messages.value.filter(item => item.id !== id)
        removing.value = []
        push({type: 'success', title: '留言已删除', description: '演示模式 · 未接入后端'})
    }, 320)
}
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div>
        <p class="eyebrow">
          <span class="section-number">03</span>
          <span class="mono">MESSAGES</span>
        </p>
        <h1>留言管理</h1>
        <p>审阅访客留言并跟进回复。当前为演示数据，未接入后端。</p>
      </div>
      <div class="admin-page-actions">
        <button class="admin-btn" type="button" @click="push({type: 'info', title: '批量标记功能待接入后端'})">
          <AdminIcon name="check" :size="15"/>
          批量标记已读
        </button>
      </div>
    </header>

    <div class="admin-toolbar">
      <div class="admin-filter-chips">
        <button v-for="tab in statusTabs" :key="tab.value" class="admin-chip"
                :class="{'is-active': filter === tab.value}" type="button" @click="filter = tab.value">
          {{ tab.label }}
          <b>{{ tab.count }}</b>
        </button>
      </div>
      <span class="admin-toolbar-spacer"/>
      <span class="mono muted">{{ filtered.length }} 条留言</span>
    </div>

    <article class="admin-panel">
      <div v-if="filtered.length">
        <div v-for="(message, index) in filtered" :key="message.id" class="admin-message"
             :class="{'is-expanded': expanded.includes(message.id), 'is-removing': removing.includes(message.id)}"
             :style="{animationDelay: `${index * 45}ms`}">
          <span class="admin-avatar is-square" :style="{background: message.color}">
            {{ message.name.slice(0, 1) }}
          </span>

          <div class="admin-message-body">
            <div class="admin-message-top">
              <strong>{{ message.name }}</strong>
              <a :href="`mailto:${message.email}`">{{ message.email }}</a>
              <span class="admin-message-time">{{ message.date }}</span>
              <AdminStatusBadge :status="message.status"/>
            </div>

            <p class="admin-message-text">{{ message.content }}</p>

            <div class="admin-message-actions">
              <button class="admin-btn is-sm is-primary" type="button" @click="setStatus(message.id, 'replied')">
                <AdminIcon name="comment" :size="13"/>
                标记已回复
              </button>
              <button class="admin-btn is-sm" type="button" @click="setStatus(message.id, 'ignored')">
                <AdminIcon name="close" :size="13"/>
                忽略
              </button>
              <button class="admin-btn is-sm is-danger" type="button" @click="removeMessage(message.id)">
                <AdminIcon name="trash" :size="13"/>
                删除
              </button>
            </div>
          </div>

          <button class="admin-row-btn" type="button" :aria-label="expanded.includes(message.id) ? '收起' : '展开'"
                  @click="toggleExpand(message.id)">
            <AdminIcon :name="expanded.includes(message.id) ? 'chevron' : 'chevron-left'" :size="14"
                      style="transform: rotate(90deg)"/>
          </button>
        </div>
      </div>

      <div v-else class="admin-empty">
        <AdminIcon name="inbox" :size="34"/>
        <strong>这个分类下还没有留言</strong>
        <p>切换其他状态查看更多内容。</p>
      </div>
    </article>
  </div>
</template>
