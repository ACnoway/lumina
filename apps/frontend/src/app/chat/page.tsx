// 聊天页占位 - 会话列表 + 流式输出
export default function ChatPage() {
  return (
    <div className="flex h-screen">
      {/* 侧边栏：会话列表 */}
      <aside className="w-64 border-r border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold mb-4">会话</h2>
        <button className="w-full rounded-lg bg-blue-600 py-2 text-white text-sm font-medium hover:bg-blue-700 mb-4">
          新建对话
        </button>
        <div className="space-y-2">
          <div className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 cursor-pointer">
            新对话
          </div>
        </div>
      </aside>
      {/* 主区域：聊天消息 */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="text-center text-gray-400 mt-20">
            开始一段新对话
          </div>
        </div>
        <div className="border-t border-gray-200 p-4">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="输入消息..."
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
            />
            <button className="rounded-lg bg-blue-600 px-6 py-2 text-white font-medium hover:bg-blue-700">
              发送
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
