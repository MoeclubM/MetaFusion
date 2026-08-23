import { defineConfig } from 'vitepress';

export default defineConfig({
  ignoreDeadLinks: true,
  base: '/docs/',
  title: 'MetaFusion 平台文档',
  description: 'MetaFusion 开放媒体资源站与元数据共建平台文档中心',
  lang: 'zh-CN',
  lastUpdated: false,
  cleanUrls: true,

  themeConfig: {
    siteTitle: 'MetaFusion Docs',
    logo: '/favicon.svg',

    nav: [
      { text: '平台指南', link: '/overview' },
      { text: '编目指引', link: '/curation-guide' },
      { text: '编辑规范', link: '/editing-guide' },
      { text: 'IFLA LRM 体系', link: '/frbr-model' },
      { text: '开放 API', link: '/api-overview' },
      { text: '社区', link: '/community-guide' },
      {
        text: '返回主站',
        link: '/',
        target: '_self'
      }
    ],

    sidebar: [
      {
        text: '📖 平台使用指南',
        items: [
          { text: '平台概览', link: '/overview' },
          { text: '快速上手指南', link: '/quickstart' },
          { text: '社区讨论与交流', link: '/community-guide' }
        ]
      },
      {
        text: '🏛️ 数据体系与分类规范',
        items: [
          { text: '权威编目与审查指引', link: '/curation-guide' },
          { text: 'IFLA LRM 增强版实体模型', link: '/frbr-model' },
          { text: '分类体系与动态标签', link: '/taxonomy' }
        ]
      },
      {
        text: '✍️ 社区共建与编辑规范',
        items: [
          { text: '词条编辑与合并规范', link: '/editing-guide' },
          { text: '资源收录与投稿标准', link: '/contribute-guide' },
          { text: '媒体上传与转码流', link: '/upload-transcode' }
        ]
      },
      {
        text: '⚡ 开放 API 与开发者专区',
        items: [
          { text: 'API 架构概览 (WS/2 范式)', link: '/api-overview' },
          { text: 'PAT 访问令牌与认证', link: '/api-auth' },
          { text: '实体查询与关联展开 (Lookup/Browse)', link: '/api-lookup-browse' },
          { text: '全文搜索与多维过滤 (Search)', link: '/api-search' },
          { text: '词条写入与合并接口', link: '/api-edit' },
          { text: '资源直传与预签名下载', link: '/api-storage' },
          { text: 'AI Agent 接入与自动化准则', link: '/api-agent' }
        ]
      },
      {
        text: '📜 社区条款与支持',
        items: [
          { text: '服务条款', link: '/terms-of-service' },
          { text: '隐私政策', link: '/privacy' },
          { text: '版权说明与 DMCA', link: '/copyright' },
          { text: '常见问题 (FAQ)', link: '/faq' },
          { text: '联系站务', link: '/contact' },
          { text: '平台更新日志', link: '/changelog' }
        ]
      }
    ],

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '搜索文档',
                buttonAriaLabel: '搜索文档'
              },
              modal: {
                noResultsText: '未找到相关结果',
                resetButtonTitle: '清除搜索条件',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭'
                }
              }
            }
          }
        }
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/MoeclubM/MetaFusion' }
    ],

    footer: {
      message: '基于 MIT 协议开放 · 社区共建开放元数据资源站',
      copyright: 'Copyright © 2026 MoeClub Ltd · MetaFusion Resource Hub'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    outline: {
      label: '页面导航',
      level: [2, 3]
    }
  }
});
