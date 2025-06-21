import React, { useState, useRef } from 'react';
import styled from 'styled-components';
import { ApiConfig } from '../types';

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
`;

const Dialog = styled.div`
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  border-radius: 16px;
  padding: 32px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
  border: 1px solid #e1e8ed;
  animation: slideIn 0.3s ease;

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(-30px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

const Title = styled.h2`
  margin: 0 0 24px 0;
  color: #2c3e50;
  font-size: 20px;
  font-weight: 600;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.label`
  color: #34495e;
  font-weight: 600;
  font-size: 14px;
`;

const Input = styled.input`
  padding: 12px 16px;
  border: 2px solid #e1e8ed;
  border-radius: 8px;
  background: white;
  font-size: 14px;
  color: #2c3e50;
  transition: all 0.3s ease;

  &:focus {
    outline: none;
    border-color: #4a90e2;
    box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
  }

  &::placeholder {
    color: #95a5a6;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
`;

const Button = styled.button<{ variant?: 'primary' | 'secondary' }>`
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
  min-width: 100px;

  ${props => props.variant === 'primary' ? `
    background: linear-gradient(135deg, #4a90e2 0%, #357abd 100%);
    color: white;

    &:hover {
      background: linear-gradient(135deg, #5ba0f2 0%, #458bcd 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
    }
  ` : `
    background: linear-gradient(135deg, #95a5a6 0%, #7f8c8d 100%);
    color: white;

    &:hover {
      background: linear-gradient(135deg, #a4b3b6 0%, #8e9b9d 100%);
      transform: translateY(-1px);
    }
  `}

  &:active {
    transform: translateY(0);
  }
`;

const Description = styled.p`
  color: #7f8c8d;
  font-size: 13px;
  margin: 0 0 20px 0;
  line-height: 1.5;
  text-align: center;
  background: rgba(255, 255, 255, 0.6);
  padding: 12px;
  border-radius: 8px;
  border-left: 4px solid #4a90e2;
`;

interface ApiSettingsDialogProps {
  apiConfig: ApiConfig;
  onSave: (config: ApiConfig) => void;
  onClose: () => void;
}

const ApiSettingsDialog: React.FC<ApiSettingsDialogProps> = ({
  apiConfig,
  onSave,
  onClose
}) => {
  const [formData, setFormData] = useState<ApiConfig>(apiConfig);
  const [isDragging, setIsDragging] = useState(false);
  
  // 处理表单提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  // 处理输入框变化
  const handleChange = (field: keyof ApiConfig, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // 处理遮罩层点击
  const handleOverlayClick = (e: React.MouseEvent) => {
    // 只有当不在拖动状态下，且点击的是遮罩层本身时才关闭
    if (e.target === e.currentTarget && !isDragging) {
      onClose();
    }
  };

  // 阻止对话框上的点击事件冒泡
  const handleDialogClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };
  
  // 监听全局鼠标按下事件
  const handleMouseDown = () => {
    setIsDragging(false);
  };
  
  // 监听全局鼠标移动事件
  const handleMouseMove = () => {
    // 如果鼠标按下并移动，标记为拖动状态
    if (isDragging === false) {
      setIsDragging(true);
    }
  };
  
  // 监听全局鼠标释放事件
  const handleMouseUp = () => {
    // 延迟重置拖动状态，确保点击事件处理完成
    setTimeout(() => {
      setIsDragging(false);
    }, 10);
  };

  return (
    <Overlay 
      onClick={handleOverlayClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <Dialog onClick={handleDialogClick}>
        <Title>
          🔑 API设置
        </Title>
        
        <Description>
          配置SimpleTex API的访问信息。如果您没有自己的API密钥，可以使用默认配置。
        </Description>

        <Form onSubmit={handleSubmit}>
          <FormGroup>
            <Label>APP ID</Label>
            <Input
              type="text"
              value={formData.appId}
              onChange={(e) => handleChange('appId', e.target.value)}
              placeholder="请输入APP ID"
            />
          </FormGroup>

          <FormGroup>
            <Label>APP Secret</Label>
            <Input
              type="password"
              value={formData.appSecret}
              onChange={(e) => handleChange('appSecret', e.target.value)}
              placeholder="请输入APP Secret"
            />
          </FormGroup>

          <ButtonGroup>
            <Button type="button" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" variant="primary">
              保存
            </Button>
          </ButtonGroup>
        </Form>
      </Dialog>
    </Overlay>
  );
};

export default ApiSettingsDialog; 