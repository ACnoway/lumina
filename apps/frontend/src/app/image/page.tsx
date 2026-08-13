// 生图页占位 - 描述 + 比例 + 提交 + 结果展示
export default function ImagePage() {
  return (
    <div className="min-h-screen p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">AI 生图</h1>
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700">描述</label>
            <textarea
              placeholder="描述你想要生成的图片..."
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none min-h-[120px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">比例</label>
            <select className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none">
              <option value="1:1">1:1 正方形</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>
          <button className="w-full rounded-lg bg-blue-600 py-2 text-white font-medium hover:bg-blue-700">
            生成图片
          </button>
        </div>
        <div className="mt-6 text-center text-gray-400">
          生成的图片会显示在这里
        </div>
      </div>
    </div>
  );
}
