使用方法

![Snipaste_2025-02-07_10-44-00](https://yangyang666.oss-cn-chengdu.aliyuncs.com/images/Snipaste_2025-02-07_10-44-00.png)



选择手动截图或上传本地图片，即可识别图片中的数学公式



![Snipaste_2025-02-07_10-44-16](https://yangyang666.oss-cn-chengdu.aliyuncs.com/images/Snipaste_2025-02-07_10-44-16.png)



设置菜单可以更换API信息，参考[https://simpletex.cn/api](https://simpletex.cn/api)

![Snipaste_2025-02-07_10-45-06](https://yangyang666.oss-cn-chengdu.aliyuncs.com/images/Snipaste_2025-02-07_10-45-06.png)![Snipaste_2025-02-07_10-44-40](https://yangyang666.oss-cn-chengdu.aliyuncs.com/images/Snipaste_2025-02-07_10-44-40.png)



复制Latex代码可以选择三种不同的格式



开发步骤：

1. ```
   git clone https://github.com/Louaq/SimpleTex-OCR 
   ```

2. cd SimpleTex-OCR

3. ```
   pip install PyQt5
   pip install Pillow
   pip install keyboard
   pip install mouse 
   ```

   

打包：

```
pyinstaller --clean --windowed --name "LaTeX公式识别工具" main.py
```

