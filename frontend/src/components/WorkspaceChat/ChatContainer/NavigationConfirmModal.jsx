import React from "react";
import ModalWrapper from "@/components/ModalWrapper";
import { X, Warning } from "@phosphor-icons/react";

export default function NavigationConfirmModal({ isOpen, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <ModalWrapper isOpen={isOpen}>
      <div className="w-full max-w-md bg-theme-bg-secondary rounded-lg shadow-xl overflow-hidden border border-theme-modal-border">
        <div className="flex justify-between items-center p-4 border-b border-theme-modal-border">
          <div className="flex items-center gap-2 text-white">
            <Warning size={24} className="text-yellow-500" />
            <h3 className="text-lg font-semibold">대화 종료 경고</h3>
          </div>
          <button
            onClick={onCancel}
            className="text-white hover:text-gray-300 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6 text-slate-300 text-sm">
          <p className="mb-2">
            현재 대화가 진행 중입니다. 페이지를 벗어나면 생성 중인 답변이
            중단될 수 있습니다.
          </p>
          <p>정말로 이동하시겠습니까?</p>
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-theme-modal-border bg-theme-bg-primary/50">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            취소하고 남기
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
          >
            응답 끊고 이동하기
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}
