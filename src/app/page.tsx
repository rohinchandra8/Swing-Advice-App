'use client';

import { useState, useRef } from 'react';
import { Button } from '@headlessui/react';
import { Dialog } from '@headlessui/react';
import ReactMarkdown from 'react-markdown';

type CameraType = 'DTL' | 'HeadOn';

async function extractFrames(file: File, frameCount = 8): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.muted = true;

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d')!;

    video.addEventListener('loadedmetadata', () => {
      const duration = video.duration;
      const timestamps = Array.from({ length: frameCount }, (_, i) =>
        (i / (frameCount - 1)) * duration
      );
      const frames: string[] = [];
      let index = 0;

      const seekNext = () => {
        if (index >= timestamps.length) {
          URL.revokeObjectURL(objectUrl);
          resolve(frames);
          return;
        }
        video.currentTime = timestamps[index];
      };

      video.addEventListener('seeked', () => {
        ctx.drawImage(video, 0, 0, 640, 360);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        frames.push(dataUrl.split(',')[1]);
        index++;
        seekNext();
      });

      seekNext();
    });

    video.addEventListener('error', () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load video'));
    });
  });
}

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [cameraType, setCameraType] = useState<CameraType | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingCameraType = useRef<CameraType | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file);
      if (pendingCameraType.current) {
        setCameraType(pendingCameraType.current);
      }
      setIsModalOpen(false);
      setAnalysisResult('');
    }
    e.target.value = '';
  };

  const handleUploadClick = (type: CameraType) => {
    pendingCameraType.current = type;
    fileInputRef.current?.click();
  };

  const handleAnalyze = async () => {
    if (!videoFile || !cameraType) return;
    setIsAnalyzing(true);
    setAnalysisResult('');

    try {
      const frames = await extractFrames(videoFile);

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frames, cameraType }),
      });

      if (!res.ok) {
        throw new Error(`Analysis failed: ${res.statusText}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnalysisResult((prev) => prev + decoder.decode(value));
      }
    } catch (err) {
      setAnalysisResult(
        `Error: ${err instanceof Error ? err.message : 'Something went wrong. Please try again.'}`
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold bg-gradient-to-b from-green-600 to-green-500 bg-clip-text text-transparent pb-0.5 leading-normal">
          AI Swing Coach
        </h1>
        <p className="text-gray-600 mt-3 text-lg">
          Perfect your golf swing with AI-powered analysis
        </p>
      </div>

      <div className="w-full max-w-2xl p-8 rounded-xl border-2 border-dashed transition-all duration-200 ease-in-out backdrop-blur-sm bg-white/30">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <div className="p-4 rounded-full bg-green-100">
            <img
              src="/icons/Swing_Icon.png"
              alt="Golf swing icon"
              className="w-12 h-12 object-contain mx-auto"
            />
          </div>
          <div className="space-y-2">
            <p className="text-xl font-semibold text-gray-700">
              {videoFile ? videoFile.name : 'No video selected'}
            </p>
            <p className="text-sm text-gray-500">
              {videoFile
                ? `${(videoFile.size / (1024 * 1024)).toFixed(2)} MB${cameraType ? ` · ${cameraType === 'DTL' ? 'Down The Line' : 'Head On'} view` : ''}`
                : 'Click upload to select your video'}
            </p>
          </div>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <Button
            type="button"
            className={`mt-4 px-8 py-3 rounded-lg font-bold transition-all duration-200 shadow-lg cursor-pointer ${
              videoFile
                ? 'bg-white text-green-600 border-2 border-green-500 hover:bg-green-50 shadow-green-500/10'
                : 'bg-green-500 text-white hover:bg-green-600 shadow-green-500/20'
            }`}
            onClick={() => setIsModalOpen(true)}
          >
            {videoFile ? 'Replace Video' : 'Upload'}
          </Button>
          {videoFile && (
            <button
              className="mt-4 px-8 py-3 bg-green-600 text-white hover:bg-green-700 rounded-lg font-medium transition-colors duration-200 shadow-lg shadow-green-600/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Analyzing...
                </>
              ) : (
                'Analyze Swing'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Analysis Results */}
      {(isAnalyzing || analysisResult) && (
        <div className="w-full max-w-2xl mt-6 rounded-xl bg-white shadow-lg overflow-hidden">
          <div className="px-6 py-4 bg-green-600">
            <h2 className="text-white font-bold text-lg">Swing Analysis</h2>
            {cameraType && (
              <p className="text-green-100 text-sm">
                {cameraType === 'DTL' ? 'Down The Line view' : 'Head On view'}
              </p>
            )}
          </div>
          <div className="px-6 py-5">
            {isAnalyzing && !analysisResult && (
              <p className="text-gray-400 italic">Analyzing your swing...</p>
            )}
            <div className="prose prose-sm prose-green max-w-none text-gray-700">
              <ReactMarkdown>{analysisResult}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-3xl h-[600px] transform overflow-hidden rounded-2xl bg-white p-8 text-left align-middle shadow-xl transition-all relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-gray-100 transition-colors duration-200"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-500 hover:text-gray-700"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <Dialog.Title
              as="h3"
              className="text-2xl font-bold text-center text-gray-900 mb-1"
            >
              Select Camera View
            </Dialog.Title>
            {videoFile && (
              <p className="text-center text-sm text-amber-600 mb-6">
                Selecting a new video will replace the current one
              </p>
            )}
            {!videoFile && <div className="mb-8" />}
            <div className="grid grid-cols-2 gap-8 h-[calc(100%-6rem)]">
              {/* Down The Line */}
              <div className="space-y-8 p-8 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors duration-200 flex flex-col items-center justify-between">
                <div className="text-center space-y-4">
                  <h4 className="text-xl font-semibold text-gray-900">Down The Line View</h4>
                  <p className="text-sm text-gray-500">
                    Record from behind in line with the target. This angle helps analyze swing path, plane, and club position.
                  </p>
                </div>
                <div className="w-32 h-32">
                  <img
                    src="/icons/DTL_Logo.webp"
                    alt="Down The Line View Icon"
                    className="w-full h-full object-contain"
                  />
                </div>
                <Button
                  type="button"
                  className="w-full px-6 py-3 bg-green-500 text-white hover:bg-green-600 rounded-lg font-bold transition-all duration-200 shadow-md"
                  onClick={() => handleUploadClick('DTL')}
                >
                  Upload DTL View
                </Button>
              </div>

              {/* Head On */}
              <div className="space-y-8 p-8 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors duration-200 flex flex-col items-center justify-between">
                <div className="text-center space-y-4">
                  <h4 className="text-xl font-semibold text-gray-900">Head On View</h4>
                  <p className="text-sm text-gray-500">
                    Record facing the golfer. This angle helps analyze body position, alignment, and weight transfer.
                  </p>
                </div>
                <div className="w-32 h-32">
                  <img
                    src="/icons/HeadOn_Logo_transparent.png"
                    alt="Head On View Icon"
                    className="w-full h-full object-contain"
                  />
                </div>
                <Button
                  type="button"
                  className="w-full px-6 py-3 bg-green-500 text-white hover:bg-green-600 rounded-lg font-bold transition-all duration-200 shadow-md"
                  onClick={() => handleUploadClick('HeadOn')}
                >
                  Upload Head On View
                </Button>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </main>
  );
}
