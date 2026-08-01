import { Component, type ErrorInfo, type PropsWithChildren } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { appendChatRenderError } from "@/core/services/chat-diagnostics";

type ChatErrorBoundaryState = {
  componentStack: string | null;
  error: Error | null;
};

export type ChatErrorBoundaryProps = PropsWithChildren<{
  fallbackDescription?: string;
  fallbackTitle?: string;
}>;

export class ChatErrorBoundary extends Component<
  ChatErrorBoundaryProps,
  ChatErrorBoundaryState
> {
  state: ChatErrorBoundaryState = {
    componentStack: null,
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const componentStack = info.componentStack ?? null;

    this.setState({ componentStack });

    appendChatRenderError({
      componentStack,
      message: error.message,
      stack: error.stack ?? null,
    });
  }

  private handleReset = () => {
    this.setState({ componentStack: null, error: null });
  };

  render() {
    const {
      children,
      fallbackDescription = "Rendering this chat hit an unexpected error. Your conversation is safe.",
      fallbackTitle = "Something went wrong",
    } = this.props;

    if (this.state.error) {
      return (
        <View className="flex-1 items-center justify-center gap-sp-3 p-sp-6">
          <Text className="font-sans text-base font-medium text-foreground dark:text-foreground-dark">
            {fallbackTitle}
          </Text>
          <Text className="px-sp-2 text-center font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
            {fallbackDescription}
          </Text>
          <Button onPress={this.handleReset} size="sm" variant="secondary">
            Try again
          </Button>
        </View>
      );
    }

    return children;
  }
}
