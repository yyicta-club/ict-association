<script setup lang="ts">
import type {PostStatus} from '~/data/admin'
import {defaultSettings} from '~/data/admin'

definePageMeta({layout: 'admin'})

useHead({title: '站点设置 · 管理后台 · 信息通信技术协会'})

const {push} = useToast()

const settings = reactive({...defaultSettings})
const saving = ref(false)
const activeSection = ref('basic')

const sections = [
    {id: 'basic', label: '基本设置', icon: 'globe'},
    {id: 'contact', label: '联系与社交', icon: 'mail'},
    {id: 'content', label: '内容与审核', icon: 'layers'},
    {id: 'account', label: '安全与账号', icon: 'shield'},
    {id: 'danger', label: '危险区域', icon: 'alert'}
]

const postStatusOptions: {label: string, value: PostStatus}[] = [
    {label: '草稿', value: 'draft'},
    {label: '待审核', value: 'review'},
    {label: '直接发布', value: 'published'}
]

const newPassword = ref('')
const showPassword = ref(false)

function save() {
    saving.value = true
    setTimeout(() => {
        saving.value = false
        push({type: 'success', title: '设置已保存', description: '演示模式 · 未接入后端'})
    }, 1000)
}

function clearCache() {
    push({type: 'info', title: '缓存已清理', description: '演示模式 · 未接入后端'})
}
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div>
        <p class="eyebrow">
          <span class="section-number">04</span>
          <span class="mono">SETTINGS</span>
        </p>
        <h1>站点设置</h1>
        <p>维护站点基础信息、联系方式与内容审核策略。当前为演示数据，未接入后端。</p>
      </div>
    </header>

    <div class="admin-settings">
      <nav class="admin-settings-nav">
        <a v-for="section in sections" :key="section.id" :href="`#${section.id}`"
           :class="{'is-active': activeSection === section.id}" @click="activeSection = section.id">
          <AdminIcon :name="section.icon" :size="14"/>
          {{ section.label }}
        </a>
      </nav>

      <div class="admin-stack">
        <article id="basic" class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>基本设置</h2>
              <p>站点的名称、标语与简介</p>
            </div>
          </div>
          <div class="admin-panel-body">
            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>站点名称</strong>
                <small>显示在浏览器标题与页头</small>
              </div>
              <input v-model="settings.siteName" class="admin-input" type="text">
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>站点标语</strong>
                <small>首页主标题下方的一句话</small>
              </div>
              <input v-model="settings.tagline" class="admin-input" type="text">
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>站点简介</strong>
                <small>用于 SEO 描述与分享卡片</small>
              </div>
              <textarea v-model="settings.description" class="admin-input" rows="3"/>
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>备案号</strong>
                <small>页脚展示的备案信息</small>
              </div>
              <input v-model="settings.icp" class="admin-input" type="text">
            </div>
          </div>
        </article>

        <article id="contact" class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>联系与社交</h2>
              <p>协会的对外联络方式</p>
            </div>
          </div>
          <div class="admin-panel-body">
            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>联系邮箱</strong>
                <small>对外公布的官方邮箱</small>
              </div>
              <input v-model="settings.email" class="admin-input" type="email">
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>QQ 群号</strong>
                <small>新同学加入的群号</small>
              </div>
              <input v-model="settings.qqGroup" class="admin-input" type="text">
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>到梦空间部落</strong>
                <small>可被搜索到的部落名称</small>
              </div>
              <input v-model="settings.dmSpace" class="admin-input" type="text">
            </div>
          </div>
        </article>

        <article id="content" class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>内容与审核</h2>
              <p>控制公告展示与留言审核策略</p>
            </div>
          </div>
          <div class="admin-panel-body">
            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>首页公告栏</strong>
                <small>在首页顶部展示最新公告</small>
              </div>
              <AdminToggleSwitch v-model="settings.announcement" label="首页公告栏开关"/>
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>留言需要审核</strong>
                <small>开启后留言需管理员确认才显示</small>
              </div>
              <AdminToggleSwitch v-model="settings.messageReview" label="留言审核开关"/>
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>默认发布状态</strong>
                <small>新建文章的初始状态</small>
              </div>
              <div class="admin-segmented">
                <button v-for="item in postStatusOptions" :key="item.value" type="button"
                        :class="{'is-active': settings.defaultPostStatus === item.value}"
                        @click="settings.defaultPostStatus = item.value">
                  {{ item.label }}
                </button>
              </div>
            </div>
          </div>
        </article>

        <article id="account" class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h2>安全与账号</h2>
              <p>管理员密码与会话策略</p>
            </div>
          </div>
          <div class="admin-panel-body">
            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>修改密码</strong>
                <small>至少 8 位，含字母与数字</small>
              </div>
              <div class="admin-input-group">
                <div class="admin-input-wrap" style="flex: 1">
                  <input v-model="newPassword" class="admin-input" :type="showPassword ? 'text' : 'password'"
                         placeholder="输入新密码">
                  <button class="admin-input-action" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                          @click="showPassword = !showPassword">
                    <AdminIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16"/>
                  </button>
                </div>
                <button class="admin-btn" type="button" @click="push({type: 'info', title: '密码修改待接入后端'})">
                  更新
                </button>
              </div>
            </div>

            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>会话保持</strong>
                <small>免登录保持的天数</small>
              </div>
              <select v-model.number="settings.sessionDays" class="admin-input">
                <option :value="1">1 天</option>
                <option :value="7">7 天</option>
                <option :value="30">30 天</option>
                <option :value="0">关闭</option>
              </select>
            </div>
          </div>
        </article>

        <article id="danger" class="admin-panel admin-danger-zone">
          <div class="admin-panel-head">
            <div>
              <h2>危险区域</h2>
              <p>以下操作不可撤销，请谨慎执行</p>
            </div>
          </div>
          <div class="admin-panel-body">
            <div class="admin-form-row">
              <div class="admin-form-label">
                <strong>清理站点缓存</strong>
                <small>重新生成静态资源缓存，提升访问速度</small>
              </div>
              <button class="admin-btn is-danger" type="button" @click="clearCache">
                <AdminIcon name="refresh" :size="15"/>
                清理缓存
              </button>
            </div>
          </div>
        </article>

        <div class="admin-savebar">
          <p>演示模式下更改仅保存在当前页面，刷新后恢复默认值。</p>
          <div class="admin-page-actions">
            <button class="admin-btn" type="button" @click="push({type: 'info', title: '已放弃未保存的更改'})">
              放弃更改
            </button>
            <button class="admin-btn is-primary" type="button" :disabled="saving" @click="save">
              <span v-if="saving" class="admin-spinner"/>
              <AdminIcon v-else name="check" :size="15"/>
              {{ saving ? '保存中…' : '保存更改' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
