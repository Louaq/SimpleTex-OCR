import datetime
import json
import requests
from random import Random
import hashlib
import sys
from PyQt5.QtWidgets import (QApplication, QMainWindow, QPushButton, QVBoxLayout, 
                            QWidget, QTextEdit, QRubberBand, QShortcut, QHBoxLayout, 
                            QLabel, QLineEdit, QToolTip, QMenuBar, QMenu, QDialog,
                            QFormLayout, QDialogButtonBox, QFileDialog, QSplitter)
from PyQt5.QtCore import Qt, QRect, QSize, QTimer, QPoint, QThread, pyqtSignal
from PyQt5.QtGui import QKeySequence, QPainter, QPen, QScreen, QColor, QPixmap, QImage
import tempfile
import os

SIMPLETEX_APP_ID = "vXSU9RyPMfUW4EQbgMWhzhQu"
SIMPLETEX_APP_SECRET = "GZiaGYq24U5evF9OXlcYIbZ2mwsuPbVu"

def random_str(randomlength=16):
    str = ''
    chars = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789'
    length = len(chars) - 1
    random = Random()
    for i in range(randomlength):
        str += chars[random.randint(0, length)]
    return str


def get_req_data(req_data, appid, secret):
    header = {}
    header["timestamp"] = str(int(datetime.datetime.now().timestamp()))
    header["random-str"] = random_str(16)
    header["app-id"] = appid
    
    # 确保 req_data 是字典类型
    if req_data is None:
        req_data = {}
    
    # 构建签名字符串
    params = []
    # 添加请求参数
    for key in sorted(req_data.keys()):
        params.append(f"{key}={req_data[key]}")
    # 添加头部参数
    for key in sorted(["timestamp", "random-str", "app-id"]):
        params.append(f"{key}={header[key]}")
    # 添加密钥
    params.append(f"secret={secret}")
    
    # 生成签名
    pre_sign_string = "&".join(params)
    header["sign"] = hashlib.md5(pre_sign_string.encode()).hexdigest()
    
    return header, req_data


class APISettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.initUI()
        # 设置对话框字体
        self.setStyleSheet("""
            * {
                font-family: "Microsoft YaHei";
                font-size: 10pt;
            }
            QLineEdit {
                padding: 3px 5px;
                min-width: 250px;
            }
            QDialogButtonBox {
                margin-top: 15px;
            }
        """)
        
    def initUI(self):
        self.setWindowTitle('API设置')
        self.setModal(True)
        layout = QFormLayout(self)
        
        # 创建输入框
        self.app_id_input = QLineEdit(self)
        self.app_secret_input = QLineEdit(self)
        
        # 设置当前值
        self.app_id_input.setText(SIMPLETEX_APP_ID)
        self.app_secret_input.setText(SIMPLETEX_APP_SECRET)
        
        # 添加到布局
        layout.addRow('APP ID:', self.app_id_input)
        layout.addRow('APP Secret:', self.app_secret_input)
        
        # 添加按钮
        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel,
            Qt.Horizontal, self)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addRow(buttons)

class AboutDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.initUI()
        
    def initUI(self):
        self.setWindowTitle('关于')
        self.setFixedSize(400, 300)  # 固定对话框大小
        
        layout = QVBoxLayout(self)
        
        # 软件名称
        title_label = QLabel('LaTeX公式识别工具')
        title_label.setStyleSheet("""
            QLabel {
                font-size: 16pt;
                font-weight: bold;
                color: #333;
                margin: 10px 0;
            }
        """)
        title_label.setAlignment(Qt.AlignCenter)
        
        # 版本信息
        version_label = QLabel('版本 1.0.0')
        version_label.setAlignment(Qt.AlignCenter)
        
        # 描述信息
        desc_label = QLabel(
            '这是一个简单的LaTeX公式识别工具，支持以下功能：\n\n'
            '• 截图识别公式\n'
            '• 上传图片识别\n'
            '• 复制为多种格式\n'
            '• 历史记录保存\n'
            '\n'
            '使用 SimpleTex API 提供识别服务\n'
            '\n'
            '© 2024 All Rights Reserved'
        )
        desc_label.setWordWrap(True)  # 允许文字换行
        desc_label.setAlignment(Qt.AlignLeft)
        desc_label.setStyleSheet('padding: 20px;')
        
        # 添加到布局
        layout.addWidget(title_label)
        layout.addWidget(version_label)
        layout.addWidget(desc_label)
        layout.addStretch()
        
        # 确定按钮
        button_box = QDialogButtonBox(QDialogButtonBox.Ok)
        button_box.accepted.connect(self.accept)
        layout.addWidget(button_box)
        
        # 设置对话框样式
        self.setStyleSheet("""
            QDialog {
                background-color: white;
            }
            QLabel {
                font-family: "Microsoft YaHei";
                font-size: 10pt;
                color: #444;
            }
            QPushButton {
                padding: 5px 15px;
                min-width: 80px;
            }
        """)

class RecognizeThread(QThread):
    finished = pyqtSignal(dict)  # 发送识别结果
    progress = pyqtSignal(str)   # 发送进度信息
    
    def __init__(self, image_path, app_id, app_secret):
        super().__init__()
        self.image_path = image_path
        self.app_id = app_id
        self.app_secret = app_secret
    
    def run(self):
        try:
            self.progress.emit("正在准备图片...")
            with open(self.image_path, 'rb') as file_obj:
                img_file = {"file": file_obj}
                data = {}
                
                self.progress.emit("正在生成请求参数...")
                header, data = get_req_data(data, self.app_id, self.app_secret)
                
                self.progress.emit("正在识别公式...")
                res = requests.post(
                    "https://server.simpletex.cn/api/latex_ocr", 
                    files=img_file, 
                    data=data, 
                    headers=header
                )
                
                self.progress.emit("正在解析结果...")
                result = json.loads(res.text)
                self.finished.emit(result)
                
        except Exception as e:
            self.finished.emit({"error": str(e)})

class ScreenshotWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.overlay = None
        self.history = []  # 初始化 history 属性
        self.load_history()  # 加载历史记录
        self.load_settings()
        self.initUI()
        # 设置全局字体
        self.setStyleSheet("""
            * {
                font-family: "Microsoft YaHei";
                font-size: 10pt;
            }
            QPushButton {
                padding: 5px 10px;
            }
            QLineEdit {
                padding: 3px 5px;
            }
            QTextEdit {
                padding: 5px;
            }
        """)
        
    def initUI(self):
        self.setWindowTitle('公式识别工具')
        self.setGeometry(100, 100, 800, 600)
        
        # 创建菜单栏
        menubar = self.menuBar()
        
        # 添加操作菜单（放在第一位）
        operationMenu = menubar.addMenu('操作')
        
        # 添加截图选项
        captureAction = operationMenu.addAction('截图 (Alt+C)')
        captureAction.triggered.connect(self.start_capture)
        
        # 添加本地上传选项
        uploadAction = operationMenu.addAction('上传图片 (Alt+U)')
        uploadAction.triggered.connect(self.upload_image)
        uploadAction.setShortcut('Alt+U')
        
        # 添加设置菜单
        settingsMenu = menubar.addMenu('设置')
        apiAction = settingsMenu.addAction('API设置')
        apiAction.triggered.connect(self.show_api_settings)
        
        # 添加历史记录菜单
        historyMenu = menubar.addMenu('历史记录')
        self.update_history_menu(historyMenu)
        
        # 添加关于菜单
        helpMenu = menubar.addMenu('帮助')
        aboutAction = helpMenu.addAction('关于')
        aboutAction.triggered.connect(self.show_about_dialog)
        
        # 创建中心部件
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)  # 改为垂直布局
        
        # 创建分割器
        splitter = QSplitter(Qt.Vertical)  # 改为垂直分割
        layout.addWidget(splitter)
        
        # 上方图片显示区域
        top_widget = QWidget()
        top_layout = QVBoxLayout(top_widget)
        
        # 图片标签
        image_label = QLabel("识别图片：")
        self.image_display = QLabel()
        self.image_display.setStyleSheet("""
            QLabel {
                border: 1px solid #ccc;
                background-color: white;
                min-width: 400px;
                min-height: 200px;
            }
        """)
        self.image_display.setAlignment(Qt.AlignCenter)
        
        top_layout.addWidget(image_label)
        top_layout.addWidget(self.image_display)
        
        # 下方LaTeX代码区域
        bottom_widget = QWidget()
        bottom_layout = QVBoxLayout(bottom_widget)
        
        latex_label = QLabel("LaTeX代码：")
        self.latex_text = QTextEdit()
        self.latex_text.setReadOnly(False)
        self.latex_text.setMinimumHeight(100)
        self.latex_text.setStyleSheet("""
            QTextEdit {
                font-family: "Microsoft YaHei";
                font-size: 10pt;
                padding: 5px;
                border: 1px solid #ccc;
                border-radius: 3px;
                background-color: white;
            }
            QTextEdit:focus {
                border: 1px solid #1E90FF;
            }
        """)
        
        # 复制按钮布局
        button_layout = QHBoxLayout()
        
        # 创建复制按钮和菜单
        self.copy_btn = QPushButton("复制Latex")
        copy_menu = QMenu(self)
        
        # 添加复制选项
        normal_action = copy_menu.addAction("复制原始代码")
        normal_action.triggered.connect(lambda: self.copy_latex('normal'))
        
        inline_action = copy_menu.addAction("复制为 $...$")
        inline_action.triggered.connect(lambda: self.copy_latex('inline'))
        
        display_action = copy_menu.addAction("复制为 $$...$$")
        display_action.triggered.connect(lambda: self.copy_latex('display'))
        
        # 设置默认动作和菜单
        self.copy_btn.setMenu(copy_menu)
        self.copy_btn.clicked.connect(lambda: self.copy_latex('normal'))  # 点击按钮时的默认动作
        
        button_layout.addStretch()
        button_layout.addWidget(self.copy_btn)
        
        # 添加状态标签
        self.status_label = QLabel()
        self.status_label.setStyleSheet("""
            QLabel {
                color: #666;
                padding: 5px;
            }
        """)
        bottom_layout.addWidget(self.status_label)
        
        bottom_layout.addWidget(latex_label)
        bottom_layout.addWidget(self.latex_text)
        bottom_layout.addLayout(button_layout)
        
        # 添加到分割器
        splitter.addWidget(top_widget)
        splitter.addWidget(bottom_widget)
        
        # 设置分割器初始大小
        splitter.setSizes([300, 300])  # 调整上下区域的初始大小比例
        
        # 设置快捷键
        shortcut = QShortcut(QKeySequence("Alt+C"), self)
        shortcut.activated.connect(self.start_capture)
    
    def copy_latex(self, mode='normal'):
        """
        复制LaTeX代码
        mode: 复制模式
            - normal: 直接复制
            - inline: 添加 $...$ 格式
            - display: 添加 $$...$$ 格式
        """
        text = self.latex_text.toPlainText().strip()
        if not text:
            return
            
        # 根据模式处理文本
        if mode == 'inline':
            text = f"${text}$"
        elif mode == 'display':
            text = f"$${text}$$"
        
        # 复制到剪贴板
        clipboard = QApplication.clipboard()
        clipboard.setText(text)
        
        # 显示复制成功提示
        QToolTip.showText(
            self.copy_btn.mapToGlobal(QPoint(0, 0)),
            "已复制到剪贴板",
            self.copy_btn,
            QRect(),
            1500  # 显示1.5秒
        )

    def start_capture(self):
        self.hide()
        if self.overlay is None:
            self.overlay = OverlayWidget(self)
        self.overlay.showFullScreen()

    def display_image(self, image_path):
        """显示图片"""
        pixmap = QPixmap(image_path)
        if not pixmap.isNull():
            # 保持宽高比例缩放
            scaled_pixmap = pixmap.scaled(
                self.image_display.width(),
                self.image_display.height(),
                Qt.KeepAspectRatio,
                Qt.SmoothTransformation
            )
            self.image_display.setPixmap(scaled_pixmap)

    def recognize_formula(self, image_path):
        # 显示图片
        self.display_image(image_path)
        
        # 清空之前的结果
        self.latex_text.clear()
        self.status_label.setText("准备识别...")
        
        # 创建并启动识别线程
        self.recognize_thread = RecognizeThread(image_path, SIMPLETEX_APP_ID, SIMPLETEX_APP_SECRET)
        self.recognize_thread.progress.connect(self.update_progress)
        self.recognize_thread.finished.connect(self.handle_recognition_result)
        self.recognize_thread.start()
    
    def update_progress(self, message):
        """更新进度信息"""
        self.status_label.setText(message)
    
    def handle_recognition_result(self, result):
        """处理识别结果"""
        if "error" in result:
            self.latex_text.setText(f"识别出错：{result['error']}")
            self.status_label.setText("识别失败")
            return
            
        if result.get('status') is True:
            latex = result.get('res', {}).get('latex', '')
            if latex:
                self.latex_text.setText(latex)
                self.status_label.setText("识别完成")
                # 添加到历史记录（确保latex不为空）
                if latex.strip():  # 确保不是空字符串
                    self.add_to_history(latex)
            else:
                self.latex_text.setText("识别结果为空")
                self.status_label.setText("识别失败")
        else:
            error_msg = result.get('message', '未知错误')
            self.latex_text.setText(f"识别失败：{error_msg}")
            self.status_label.setText("识别失败")

    def show_api_settings(self):
        dialog = APISettingsDialog(self)
        if dialog.exec_() == QDialog.Accepted:
            global SIMPLETEX_APP_ID, SIMPLETEX_APP_SECRET
            SIMPLETEX_APP_ID = dialog.app_id_input.text()
            SIMPLETEX_APP_SECRET = dialog.app_secret_input.text()
            self.save_settings()
    
    def load_settings(self):
        try:
            if os.path.exists('settings.json'):
                with open('settings.json', 'r') as f:
                    settings = json.load(f)
                    global SIMPLETEX_APP_ID, SIMPLETEX_APP_SECRET
                    SIMPLETEX_APP_ID = settings.get('app_id', SIMPLETEX_APP_ID)
                    SIMPLETEX_APP_SECRET = settings.get('app_secret', SIMPLETEX_APP_SECRET)
        except Exception as e:
            print(f"加载设置失败: {e}")
    
    def save_settings(self):
        try:
            settings = {
                'app_id': SIMPLETEX_APP_ID,
                'app_secret': SIMPLETEX_APP_SECRET
            }
            with open('settings.json', 'w') as f:
                json.dump(settings, f)
        except Exception as e:
            print(f"保存设置失败: {e}")

    def upload_image(self):
        """处理本地图片上传"""
        file_name, _ = QFileDialog.getOpenFileName(
            self,
            "选择图片",
            "",
            "图片文件 (*.png *.jpg *.jpeg *.bmp);;所有文件 (*.*)"
        )
        
        if file_name:
            try:
                # 直接使用选择的图片文件进行识别
                self.recognize_formula(file_name)
            except Exception as e:
                self.result_text.setText(f"图片处理失败：{str(e)}")

    def update_history_menu(self, menu=None):
        """更新历史记录菜单"""
        if menu is None:
            menu = self.menuBar().findChild(QMenu, 'historyMenu')
            if not menu:
                return
        
        menu.clear()
        for item in self.history:
            # 获取 LaTeX 代码的前30个字符，如果超过30个字符则添加省略号
            latex_preview = item['latex'][:30]
            if len(item['latex']) > 30:
                latex_preview += "..."
                
            # 创建菜单项，显示日期和LaTeX预览
            action = menu.addAction(f"{item['date']} - {latex_preview}")
            action.setToolTip(item['latex'])  # 添加工具提示，显示完整公式
            action.setData(item)
            action.triggered.connect(self.load_history_item)

    def load_history_item(self):
        """加载历史记录项"""
        action = self.sender()
        if action:
            item = action.data()
            self.latex_text.setText(item['latex'])
    
    def add_to_history(self, latex):
        """添加新的历史记录"""
        if not latex or not latex.strip():  # 检查是否为空或只包含空白字符
            return
            
        # 创建新的历史记录项
        new_item = {
            'date': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'latex': latex.strip()  # 确保去除首尾空白字符
        }
        
        # 检查是否已存在相同的记录
        if any(item['latex'] == new_item['latex'] for item in self.history):
            return
        
        # 添加到历史记录列表
        self.history.insert(0, new_item)
        
        # 保持最多5条记录
        self.history = self.history[:5]
        
        # 保存历史记录
        self.save_history()
        
        # 更新菜单
        history_menu = self.menuBar().findChild(QMenu, 'historyMenu')
        if history_menu:
            self.update_history_menu(history_menu)
    
    def save_history(self):
        """保存历史记录到文件"""
        try:
            with open('history.json', 'w', encoding='utf-8') as f:
                json.dump(self.history, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存历史记录失败: {e}")
    
    def load_history(self):
        """从文件加载历史记录"""
        try:
            if os.path.exists('history.json'):
                with open('history.json', 'r', encoding='utf-8') as f:
                    self.history = json.load(f)
        except Exception as e:
            print(f"加载历史记录失败: {e}")
            self.history = []

    def show_about_dialog(self):
        """显示关于对话框"""
        dialog = AboutDialog(self)
        dialog.exec_()

    def closeEvent(self, event):
        """窗口关闭事件处理"""
        try:
            # 清空历史记录文件
            if os.path.exists('history.json'):
                os.remove('history.json')
            
            # 清空历史记录列表
            self.history.clear()
            
            # 接受关闭事件
            event.accept()
            
        except Exception as e:
            print(f"清理历史记录失败: {e}")
            event.accept()  # 即使清理失败也允许关闭

class OverlayWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__()
        self.parent = parent
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.setStyleSheet("""
            * {
                font-family: "Microsoft YaHei";
                font-size: 10pt;
            }
            QWidget {
                background-color: rgba(0, 0, 0, 100);
            }
            QRubberBand {
                border: 2px solid #1E90FF;
                background-color: rgba(30, 144, 255, 30);
            }
        """)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setCursor(Qt.CrossCursor)
        
        self.rubberband = QRubberBand(QRubberBand.Rectangle, self)
        self.origin = None
        self.current_geometry = None
        
        screen = QApplication.primaryScreen().geometry()
        self.setGeometry(screen)
    
    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.close()
            self.parent.show()
    
    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.origin = event.pos()
            self.rubberband.setGeometry(QRect(self.origin, QSize()))
            self.rubberband.show()
    
    def mouseMoveEvent(self, event):
        if self.origin:
            rect = QRect(self.origin, event.pos()).normalized()
            self.current_geometry = rect
            self.rubberband.setGeometry(rect)
            self.update()
    
    def mouseReleaseEvent(self, event):
        if event.button() == Qt.LeftButton and self.rubberband.isVisible():
            self.current_geometry = self.rubberband.geometry()
            if self.current_geometry.width() > 10 and self.current_geometry.height() > 10:
                QTimer.singleShot(100, self.take_screenshot)
            else:
                self.close()
                self.parent.show()
    
    def paintEvent(self, event):
        painter = QPainter(self)
        # 绘制半透明背景
        mask = QColor(0, 0, 0, 100)
        painter.fillRect(self.rect(), mask)
        
        if self.current_geometry:
            # 清除选区的遮罩（使选区透明）
            painter.setCompositionMode(QPainter.CompositionMode_Clear)
            painter.fillRect(self.current_geometry, Qt.transparent)
            
            # 恢复正常绘制模式
            painter.setCompositionMode(QPainter.CompositionMode_SourceOver)
            
            # 绘制选区边框
            painter.setPen(QPen(Qt.white, 2, Qt.SolidLine))
            painter.drawRect(self.current_geometry)
            
            # 绘制选区大小信息
            size_text = f"{self.current_geometry.width()} x {self.current_geometry.height()}"
            painter.drawText(
                self.current_geometry.right() + 5,
                self.current_geometry.top() + 20,
                size_text
            )
    
    def take_screenshot(self):
        temp_file = None
        try:
            # 先关闭截图界面并显示主窗口
            self.close()
            self.parent.show()
            
            # 等待一下确保界面切换完成
            QTimer.singleShot(100, lambda: self._do_screenshot(temp_file))
            
        except Exception as e:
            self.parent.result_text.setText(f"截图失败：{str(e)}")
            self.close()
            self.parent.show()
    
    def _do_screenshot(self, temp_file):
        try:
            screen = QApplication.primaryScreen()
            screenshot = screen.grabWindow(0, 
                                        self.current_geometry.x(), 
                                        self.current_geometry.y(),
                                        self.current_geometry.width(), 
                                        self.current_geometry.height())
            
            # 创建临时文件
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
            temp_file.close()
            
            # 保存截图
            screenshot.save(temp_file.name, 'PNG')
            
            # 显示图片并识别公式
            self.parent.display_image(temp_file.name)
            self.parent.recognize_formula(temp_file.name)
            
        except Exception as e:
            self.parent.latex_text.setText(f"截图失败：{str(e)}")
        finally:
            if temp_file:
                try:
                    os.unlink(temp_file.name)
                except:
                    pass

def main():
    app = QApplication(sys.argv)
    window = ScreenshotWindow()
    window.show()
    sys.exit(app.exec_())

if __name__ == '__main__':
    main()
