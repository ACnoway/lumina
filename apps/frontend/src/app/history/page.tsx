// 历史记录页占位 - 聊天 + 图片列表
export default function HistoryPage() {
  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">历史记录</h1>
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 hover:shadow-md cursor-pointer">
            <div className="flex items-center justify-between">
              <span className="font-medium">新对话</span>
              <span className="text-sm text-gray-400">2026-08-13</span>
            </div>
          </div>
        </div>
        <div className="mt-8 text-center text-gray-400">
          暂无更多记录
        </div>
      </div>
    </div>
  );
}
